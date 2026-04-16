//! Round-trip every event discriminator in every committed IDL.
//!
//! For each event, a deterministic sample generator walks the IDL schema to
//! produce (borsh bytes, expected JSON). The bytes are fed through
//! `decode_event`; the resulting JSON body must equal the expected JSON, the
//! discriminator must resolve to the same event name, and the cursor must
//! consume every byte. This covers all the shapes the live indexer will see on
//! devnet — primitives, nested types, options, vecs, fixed arrays, enums.

use std::collections::HashMap;
use std::path::PathBuf;

use saep_indexer::borsh_decode::{decode, Cursor};
use saep_indexer::idl::Registry;
use saep_indexer::ingest::decode_event;
use serde_json::{json, Map, Value};

fn idl_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("idl")
}

struct Rng(u64);

impl Rng {
    fn seed_from_bytes(bytes: &[u8]) -> Self {
        let mut h: u64 = 0xcbf29ce484222325;
        for b in bytes {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        Rng(h)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0
    }

    fn bounded(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next_u64() % n
        }
    }
}

struct Encoder {
    bytes: Vec<u8>,
}

impl Encoder {
    fn new() -> Self {
        Self { bytes: Vec::new() }
    }
}

fn gen(
    schema: &Value,
    types: &HashMap<String, Value>,
    rng: &mut Rng,
    enc: &mut Encoder,
) -> Value {
    if let Some(obj) = schema.as_object() {
        if let Some(kind) = obj.get("kind").and_then(|k| k.as_str()) {
            return match kind {
                "struct" => gen_struct(obj, types, rng, enc),
                "enum" => gen_enum(obj, types, rng, enc),
                other => panic!("unsupported kind: {other}"),
            };
        }
        return gen_scalar(schema, types, rng, enc);
    }
    if schema.is_string() {
        return gen_scalar(schema, types, rng, enc);
    }
    panic!("unrecognised schema shape: {schema}");
}

fn gen_struct(
    obj: &Map<String, Value>,
    types: &HashMap<String, Value>,
    rng: &mut Rng,
    enc: &mut Encoder,
) -> Value {
    let fields = obj
        .get("fields")
        .and_then(|f| f.as_array())
        .expect("struct missing fields");
    let mut out = Map::new();
    for f in fields {
        let name = f.get("name").and_then(|n| n.as_str()).unwrap_or("_");
        let ty = f.get("type").expect("field missing type");
        out.insert(name.to_string(), gen_scalar(ty, types, rng, enc));
    }
    Value::Object(out)
}

fn gen_enum(
    obj: &Map<String, Value>,
    types: &HashMap<String, Value>,
    rng: &mut Rng,
    enc: &mut Encoder,
) -> Value {
    let variants = obj
        .get("variants")
        .and_then(|v| v.as_array())
        .expect("enum missing variants");
    assert!(!variants.is_empty(), "enum with no variants");
    let tag = rng.bounded(variants.len() as u64) as usize;
    enc.bytes.push(tag as u8);
    let v = &variants[tag];
    let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("_");
    if let Some(fields) = v.get("fields").and_then(|f| f.as_array()) {
        let mut inner = Map::new();
        for (i, f) in fields.iter().enumerate() {
            let fname = f
                .get("name")
                .and_then(|n| n.as_str())
                .map(String::from)
                .unwrap_or_else(|| i.to_string());
            let fty = f.get("type").unwrap_or(f);
            inner.insert(fname, gen_scalar(fty, types, rng, enc));
        }
        json!({ name: Value::Object(inner) })
    } else {
        Value::String(name.to_string())
    }
}

fn gen_scalar(
    ty: &Value,
    types: &HashMap<String, Value>,
    rng: &mut Rng,
    enc: &mut Encoder,
) -> Value {
    if let Some(s) = ty.as_str() {
        return gen_primitive(s, rng, enc);
    }
    if let Some(obj) = ty.as_object() {
        if let Some(inner) = obj.get("defined") {
            let name = match inner {
                Value::String(s) => s.as_str(),
                Value::Object(o) => o
                    .get("name")
                    .and_then(|n| n.as_str())
                    .expect("defined missing name"),
                _ => panic!("unsupported defined shape"),
            };
            let schema = types
                .get(name)
                .unwrap_or_else(|| panic!("type `{name}` not in registry"))
                .clone();
            return gen(&schema, types, rng, enc);
        }
        if let Some(inner) = obj.get("option") {
            let tag = (rng.next_u64() & 1) as u8;
            enc.bytes.push(tag);
            return if tag == 0 {
                Value::Null
            } else {
                gen_scalar(inner, types, rng, enc)
            };
        }
        if let Some(inner) = obj.get("vec") {
            let len = (rng.bounded(4) + 1) as u32;
            enc.bytes.extend_from_slice(&len.to_le_bytes());
            let mut arr = Vec::with_capacity(len as usize);
            for _ in 0..len {
                arr.push(gen_scalar(inner, types, rng, enc));
            }
            return Value::Array(arr);
        }
        if let Some(spec) = obj.get("array") {
            let arr = spec.as_array().expect("array spec not array");
            let inner = arr.first().expect("array missing type");
            let len = arr
                .get(1)
                .and_then(|n| n.as_u64())
                .expect("array missing length") as usize;
            let mut out = Vec::with_capacity(len);
            for _ in 0..len {
                out.push(gen_scalar(inner, types, rng, enc));
            }
            return Value::Array(out);
        }
    }
    panic!("unsupported type: {ty}");
}

fn gen_primitive(name: &str, rng: &mut Rng, enc: &mut Encoder) -> Value {
    match name {
        "bool" => {
            let v = (rng.next_u64() & 1) != 0;
            enc.bytes.push(if v { 1 } else { 0 });
            Value::Bool(v)
        }
        "u8" => {
            let v = rng.next_u64() as u8;
            enc.bytes.push(v);
            json!(v)
        }
        "i8" => {
            let v = rng.next_u64() as i8;
            enc.bytes.push(v as u8);
            json!(v)
        }
        "u16" => {
            let v = rng.next_u64() as u16;
            enc.bytes.extend_from_slice(&v.to_le_bytes());
            json!(v)
        }
        "i16" => {
            let v = rng.next_u64() as i16;
            enc.bytes.extend_from_slice(&v.to_le_bytes());
            json!(v)
        }
        "u32" => {
            let v = rng.next_u64() as u32;
            enc.bytes.extend_from_slice(&v.to_le_bytes());
            json!(v)
        }
        "i32" => {
            let v = rng.next_u64() as i32;
            enc.bytes.extend_from_slice(&v.to_le_bytes());
            json!(v)
        }
        "u64" => {
            let v = rng.next_u64();
            enc.bytes.extend_from_slice(&v.to_le_bytes());
            json!(v.to_string())
        }
        "i64" => {
            let v = rng.next_u64() as i64;
            enc.bytes.extend_from_slice(&v.to_le_bytes());
            json!(v.to_string())
        }
        "u128" => {
            let hi = rng.next_u64() as u128;
            let lo = rng.next_u64() as u128;
            let v = (hi << 64) | lo;
            enc.bytes.extend_from_slice(&v.to_le_bytes());
            json!(v.to_string())
        }
        "i128" => {
            let hi = rng.next_u64() as u128;
            let lo = rng.next_u64() as u128;
            let v = ((hi << 64) | lo) as i128;
            enc.bytes.extend_from_slice(&v.to_le_bytes());
            json!(v.to_string())
        }
        "pubkey" | "publicKey" => {
            let mut b = [0u8; 32];
            for chunk in b.chunks_mut(8) {
                chunk.copy_from_slice(&rng.next_u64().to_le_bytes());
            }
            enc.bytes.extend_from_slice(&b);
            Value::String(bs58::encode(b).into_string())
        }
        "string" => {
            let len = (rng.bounded(8) + 1) as u32;
            let s: String = (0..len)
                .map(|_| {
                    let c = (rng.next_u64() % 26) as u8 + b'a';
                    c as char
                })
                .collect();
            enc.bytes.extend_from_slice(&len.to_le_bytes());
            enc.bytes.extend_from_slice(s.as_bytes());
            Value::String(s)
        }
        "bytes" => {
            let len = (rng.bounded(8) + 1) as u32;
            let mut b = vec![0u8; len as usize];
            for byte in &mut b {
                *byte = rng.next_u64() as u8;
            }
            enc.bytes.extend_from_slice(&len.to_le_bytes());
            enc.bytes.extend_from_slice(&b);
            Value::String(hex::encode(&b))
        }
        other => panic!("unknown primitive: {other}"),
    }
}

#[test]
fn roundtrip_every_idl_event() {
    let dir = idl_dir();
    assert!(dir.exists(), "committed IDL dir missing: {}", dir.display());
    let reg = Registry::load_from_dir(&dir).expect("load registry");
    assert!(reg.event_count() > 0, "no events discovered");

    let mut checked = 0usize;
    for def in reg.iter_events() {
        let mut rng = Rng::seed_from_bytes(def.event_name.as_bytes());
        let mut enc = Encoder::new();
        let expected = gen(&def.schema, &def.type_registry, &mut rng, &mut enc);

        let mut framed = Vec::with_capacity(8 + enc.bytes.len());
        framed.extend_from_slice(&def.discriminator);
        framed.extend_from_slice(&enc.bytes);

        let (name, body) = decode_event(&reg, &def.program_id, &framed)
            .unwrap_or_else(|| panic!("decode_event returned None for {}", def.event_name));
        assert_eq!(name, def.event_name, "discriminator routed to wrong event");
        assert!(
            !body.get("_decode_error").is_some(),
            "decode error for {}: {}",
            def.event_name,
            body
        );
        assert_eq!(
            body, expected,
            "JSON mismatch for {} ({})",
            def.event_name, def.program_name
        );
        checked += 1;
    }
    assert!(checked >= 50, "expected ≥50 events, got {checked}");
}

#[test]
fn primitives_not_in_events_still_roundtrip() {
    let cases = [
        ("i8", json!({ "kind": "struct", "fields": [{ "name": "v", "type": "i8" }] })),
        ("i16", json!({ "kind": "struct", "fields": [{ "name": "v", "type": "i16" }] })),
        ("i32", json!({ "kind": "struct", "fields": [{ "name": "v", "type": "i32" }] })),
        ("i128", json!({ "kind": "struct", "fields": [{ "name": "v", "type": "i128" }] })),
        ("string", json!({ "kind": "struct", "fields": [{ "name": "v", "type": "string" }] })),
        ("bytes", json!({ "kind": "struct", "fields": [{ "name": "v", "type": "bytes" }] })),
    ];
    let types = HashMap::new();
    for (label, schema) in cases {
        let mut rng = Rng::seed_from_bytes(label.as_bytes());
        let mut enc = Encoder::new();
        let expected = gen(&schema, &types, &mut rng, &mut enc);
        let mut cur = Cursor::new(&enc.bytes);
        let body = decode(&schema, &types, &mut cur).expect("decode");
        assert_eq!(body, expected, "{label}");
        assert_eq!(cur.remaining(), 0, "{label} left unread bytes");
    }
}

#[test]
fn truncated_payload_reports_decode_error() {
    let dir = idl_dir();
    if !dir.exists() {
        return;
    }
    let reg = Registry::load_from_dir(&dir).expect("load");
    let def = reg
        .iter_events()
        .next()
        .expect("at least one event expected");
    // Discriminator + zero payload bytes — any non-empty schema must fail cleanly.
    let (name, body) = decode_event(&reg, &def.program_id, &def.discriminator)
        .expect("lookup matches discriminator");
    assert_eq!(name, def.event_name);
    assert!(
        body.get("_decode_error").is_some(),
        "expected _decode_error fallback, got {body}"
    );
    assert!(body.get("raw_hex").is_some());
}

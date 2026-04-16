use anyhow::{anyhow, bail, Result};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub struct Cursor<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if self.pos + n > self.buf.len() {
            bail!("unexpected EOF (need {n} at {})", self.pos);
        }
        let out = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(out)
    }
    fn u8(&mut self) -> Result<u8> { Ok(self.take(1)?[0]) }
    pub fn pos(&self) -> usize { self.pos }
    pub fn remaining(&self) -> usize { self.buf.len() - self.pos }
    fn u32_le(&mut self) -> Result<u32> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
}

/// Decode an Anchor/Borsh payload against an IDL type schema, producing
/// a structured `serde_json::Value`. Schema is the `"type"` object from the
/// IDL `types[]` entry (e.g. `{ "kind": "struct", "fields": [...] }`).
pub fn decode(
    schema: &Value,
    types: &HashMap<String, Value>,
    cur: &mut Cursor,
) -> Result<Value> {
    if let Some(obj) = schema.as_object() {
        if let Some(kind) = obj.get("kind").and_then(|k| k.as_str()) {
            return match kind {
                "struct" => decode_struct(obj, types, cur),
                "enum" => decode_enum(obj, types, cur),
                other => bail!("unsupported kind: {other}"),
            };
        }
        return decode_scalar(schema, types, cur);
    }
    if schema.is_string() {
        return decode_scalar(schema, types, cur);
    }
    bail!("unrecognised schema shape: {schema}")
}

fn decode_struct(
    obj: &Map<String, Value>,
    types: &HashMap<String, Value>,
    cur: &mut Cursor,
) -> Result<Value> {
    let fields = obj
        .get("fields")
        .and_then(|f| f.as_array())
        .ok_or_else(|| anyhow!("struct missing fields"))?;
    let mut out = Map::new();
    for f in fields {
        let name = f.get("name").and_then(|n| n.as_str()).unwrap_or("_");
        let ty = f
            .get("type")
            .ok_or_else(|| anyhow!("field {name} missing type"))?;
        out.insert(name.to_string(), decode_scalar(ty, types, cur)?);
    }
    Ok(Value::Object(out))
}

fn decode_enum(
    obj: &Map<String, Value>,
    types: &HashMap<String, Value>,
    cur: &mut Cursor,
) -> Result<Value> {
    let variants = obj
        .get("variants")
        .and_then(|v| v.as_array())
        .ok_or_else(|| anyhow!("enum missing variants"))?;
    let tag = cur.u8()? as usize;
    let v = variants
        .get(tag)
        .ok_or_else(|| anyhow!("enum tag {tag} out of range"))?;
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
            inner.insert(fname, decode_scalar(fty, types, cur)?);
        }
        Ok(json!({ name: Value::Object(inner) }))
    } else {
        Ok(Value::String(name.to_string()))
    }
}

fn decode_scalar(
    ty: &Value,
    types: &HashMap<String, Value>,
    cur: &mut Cursor,
) -> Result<Value> {
    if let Some(s) = ty.as_str() {
        return decode_primitive(s, cur);
    }
    if let Some(obj) = ty.as_object() {
        if let Some(inner) = obj.get("defined") {
            let name = match inner {
                Value::String(s) => s.as_str(),
                Value::Object(o) => o
                    .get("name")
                    .and_then(|n| n.as_str())
                    .ok_or_else(|| anyhow!("defined missing name"))?,
                _ => bail!("unsupported defined shape"),
            };
            let schema = types
                .get(name)
                .ok_or_else(|| anyhow!("type `{name}` not in registry"))?
                .clone();
            return decode(&schema, types, cur);
        }
        if let Some(inner) = obj.get("option") {
            return if cur.u8()? == 0 {
                Ok(Value::Null)
            } else {
                decode_scalar(inner, types, cur)
            };
        }
        if let Some(inner) = obj.get("vec") {
            let len = cur.u32_le()? as usize;
            let mut arr = Vec::with_capacity(len);
            for _ in 0..len {
                arr.push(decode_scalar(inner, types, cur)?);
            }
            return Ok(Value::Array(arr));
        }
        if let Some(spec) = obj.get("array") {
            let arr = spec.as_array().ok_or_else(|| anyhow!("array spec not array"))?;
            let inner = arr.first().ok_or_else(|| anyhow!("array missing type"))?;
            let len = arr
                .get(1)
                .and_then(|n| n.as_u64())
                .ok_or_else(|| anyhow!("array missing length"))? as usize;
            let mut out = Vec::with_capacity(len);
            for _ in 0..len {
                out.push(decode_scalar(inner, types, cur)?);
            }
            return Ok(Value::Array(out));
        }
    }
    bail!("unsupported type: {ty}")
}

fn decode_primitive(name: &str, cur: &mut Cursor) -> Result<Value> {
    Ok(match name {
        "bool" => Value::Bool(cur.u8()? != 0),
        "u8" => json!(cur.u8()?),
        "i8" => json!(cur.take(1)?[0] as i8),
        "u16" => {
            let b = cur.take(2)?;
            json!(u16::from_le_bytes([b[0], b[1]]))
        }
        "i16" => {
            let b = cur.take(2)?;
            json!(i16::from_le_bytes([b[0], b[1]]))
        }
        "u32" => json!(cur.u32_le()?),
        "i32" => {
            let b = cur.take(4)?;
            json!(i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        }
        "u64" => {
            let b = cur.take(8)?;
            json!(u64::from_le_bytes(b.try_into().unwrap()).to_string())
        }
        "i64" => {
            let b = cur.take(8)?;
            json!(i64::from_le_bytes(b.try_into().unwrap()).to_string())
        }
        "u128" => {
            let b = cur.take(16)?;
            json!(u128::from_le_bytes(b.try_into().unwrap()).to_string())
        }
        "i128" => {
            let b = cur.take(16)?;
            json!(i128::from_le_bytes(b.try_into().unwrap()).to_string())
        }
        "pubkey" | "publicKey" => {
            let b = cur.take(32)?;
            Value::String(bs58::encode(b).into_string())
        }
        "string" => {
            let len = cur.u32_le()? as usize;
            let b = cur.take(len)?;
            Value::String(String::from_utf8_lossy(b).into_owned())
        }
        "bytes" => {
            let len = cur.u32_le()? as usize;
            Value::String(hex::encode(cur.take(len)?))
        }
        other => bail!("unknown primitive: {other}"),
    })
}

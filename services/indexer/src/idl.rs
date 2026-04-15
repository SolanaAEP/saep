use anyhow::{Context, Result};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
struct IdlRoot {
    address: String,
    metadata: IdlMetadata,
    #[serde(default)]
    events: Vec<IdlEvent>,
    #[serde(default)]
    types: Vec<IdlType>,
}

#[derive(Debug, Deserialize)]
struct IdlMetadata {
    name: String,
}

#[derive(Debug, Deserialize)]
struct IdlEvent {
    name: String,
    #[serde(default)]
    discriminator: Option<[u8; 8]>,
}

#[derive(Debug, Deserialize, Clone)]
struct IdlType {
    name: String,
    #[serde(rename = "type")]
    ty: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct EventDef {
    pub program_name: String,
    pub program_id: String,
    pub event_name: String,
    pub schema: serde_json::Value,
    pub type_registry: std::sync::Arc<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Default)]
pub struct Registry {
    by_discriminator: HashMap<(String, [u8; 8]), EventDef>,
    programs_loaded: Vec<String>,
}

impl Registry {
    pub fn load_from_dir(dir: impl AsRef<Path>) -> Result<Self> {
        let dir = dir.as_ref();
        let mut reg = Registry::default();

        let entries = fs::read_dir(dir)
            .with_context(|| format!("read idl dir {}", dir.display()))?;

        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let raw = fs::read_to_string(&path)
                .with_context(|| format!("read {}", path.display()))?;
            let idl: IdlRoot = serde_json::from_str(&raw)
                .with_context(|| format!("parse {}", path.display()))?;

            let type_registry: HashMap<String, serde_json::Value> = idl
                .types
                .iter()
                .map(|t| (t.name.clone(), t.ty.clone()))
                .collect();
            let type_registry = std::sync::Arc::new(type_registry);

            reg.programs_loaded.push(idl.metadata.name.clone());

            for ev in &idl.events {
                let disc = ev
                    .discriminator
                    .unwrap_or_else(|| event_discriminator(&ev.name));
                let schema = type_registry
                    .get(&ev.name)
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                reg.by_discriminator.insert(
                    (idl.address.clone(), disc),
                    EventDef {
                        program_name: idl.metadata.name.clone(),
                        program_id: idl.address.clone(),
                        event_name: ev.name.clone(),
                        schema,
                        type_registry: type_registry.clone(),
                    },
                );
            }
        }

        Ok(reg)
    }

    pub fn lookup(&self, program_id: &str, data: &[u8]) -> Option<&EventDef> {
        if data.len() < 8 {
            return None;
        }
        let mut disc = [0u8; 8];
        disc.copy_from_slice(&data[..8]);
        self.by_discriminator.get(&(program_id.to_string(), disc))
    }

    pub fn event_count(&self) -> usize {
        self.by_discriminator.len()
    }

    pub fn programs_loaded(&self) -> &[String] {
        &self.programs_loaded
    }
}

pub fn event_discriminator(name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("event:{name}").as_bytes());
    let out = hasher.finalize();
    let mut d = [0u8; 8];
    d.copy_from_slice(&out[..8]);
    d
}

pub fn default_idl_path() -> PathBuf {
    std::env::var("SAEP_IDL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("../../target/idl"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crate_idl_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/idl")
    }

    #[test]
    fn discriminator_matches_anchor_convention() {
        let a = event_discriminator("GlobalInitialized");
        let b = event_discriminator("GlobalInitialized");
        assert_eq!(a, b);
        assert_ne!(a, event_discriminator("GlobalParamsUpdated"));
    }

    #[test]
    fn loads_committed_idls() {
        let dir = crate_idl_dir();
        if !dir.exists() {
            return;
        }
        let reg = Registry::load_from_dir(&dir).expect("load registry");
        assert!(!reg.programs_loaded().is_empty());
    }
}

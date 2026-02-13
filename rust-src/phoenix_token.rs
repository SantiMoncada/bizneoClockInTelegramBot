use base64::Engine;
use serde_json::{Map, Value};

pub fn parse_phoenix_token(token: &str) -> Option<Map<String, Value>> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 || parts[0] != "SFMyNTY" {
        return None;
    }

    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(parts[1]))
        .ok()?;

    let mut decoder = EtfDecoder::new(raw);
    match decoder.decode()? {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

pub fn parse_user_id(token: &str) -> Option<i64> {
    let map = parse_phoenix_token(token)?;
    let v = map.get("user_id")?;

    match v {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.parse::<i64>().ok(),
        _ => None,
    }
}

struct EtfDecoder {
    data: Vec<u8>,
    offset: usize,
}

impl EtfDecoder {
    fn new(data: Vec<u8>) -> Self {
        Self { data, offset: 0 }
    }

    fn decode(&mut self) -> Option<Value> {
        let tag = self.read_byte()?;
        match tag {
            131 => self.decode(),
            116 => self.decode_map(),
            109 => self.decode_binary(),
            98 => self.decode_integer().map(|n| Value::Number(n.into())),
            97 => self.read_byte().map(|n| Value::Number((n as i64).into())),
            _ => None,
        }
    }

    fn decode_map(&mut self) -> Option<Value> {
        let arity = self.read_u32_be()? as usize;
        let mut out = Map::new();

        for _ in 0..arity {
            let key = self.decode()?;
            let value = self.decode()?;
            if let Value::String(k) = key {
                out.insert(k, value);
            }
        }

        Some(Value::Object(out))
    }

    fn decode_binary(&mut self) -> Option<Value> {
        let length = self.read_u32_be()? as usize;
        let end = self.offset.checked_add(length)?;
        if end > self.data.len() {
            return None;
        }

        let bytes = &self.data[self.offset..end];
        self.offset = end;
        let text = String::from_utf8(bytes.to_vec()).ok()?;
        Some(Value::String(text))
    }

    fn decode_integer(&mut self) -> Option<i64> {
        let bytes = self.read_4()?;
        let value = i32::from_be_bytes(bytes);
        Some(value as i64)
    }

    fn read_u32_be(&mut self) -> Option<u32> {
        let bytes = self.read_4()?;
        Some(u32::from_be_bytes(bytes))
    }

    fn read_4(&mut self) -> Option<[u8; 4]> {
        let end = self.offset.checked_add(4)?;
        if end > self.data.len() {
            return None;
        }

        let mut out = [0u8; 4];
        out.copy_from_slice(&self.data[self.offset..end]);
        self.offset = end;
        Some(out)
    }

    fn read_byte(&mut self) -> Option<u8> {
        let byte = *self.data.get(self.offset)?;
        self.offset += 1;
        Some(byte)
    }
}

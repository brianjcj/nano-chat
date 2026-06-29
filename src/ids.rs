use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sqlx::encode::IsNull;
use sqlx::error::BoxDynError;
use sqlx::postgres::{PgTypeInfo, PgValueRef};
use sqlx::{Decode, Encode, Postgres, Type};
use std::fmt;
use std::str::FromStr;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct UserId(i64);

impl UserId {
    pub fn new(value: i64) -> Option<Self> {
        (value > 0).then_some(Self(value))
    }

    pub fn get(self) -> i64 {
        self.0
    }
}

impl FromStr for UserId {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let value = s.parse::<i64>().map_err(|_| "invalid user id".to_owned())?;
        Self::new(value).ok_or_else(|| "user id must be positive".to_owned())
    }
}

impl fmt::Display for UserId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl Serialize for UserId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for UserId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        value.parse::<Self>().map_err(serde::de::Error::custom)
    }
}

impl Type<Postgres> for UserId {
    fn type_info() -> PgTypeInfo {
        <i64 as Type<Postgres>>::type_info()
    }

    fn compatible(ty: &PgTypeInfo) -> bool {
        <i64 as Type<Postgres>>::compatible(ty)
    }
}

impl<'q> Encode<'q, Postgres> for UserId {
    fn encode_by_ref(
        &self,
        buf: &mut <Postgres as sqlx::Database>::ArgumentBuffer<'q>,
    ) -> Result<IsNull, BoxDynError> {
        <i64 as Encode<Postgres>>::encode_by_ref(&self.0, buf)
    }

    fn size_hint(&self) -> usize {
        <i64 as Encode<Postgres>>::size_hint(&self.0)
    }
}

impl<'r> Decode<'r, Postgres> for UserId {
    fn decode(value: PgValueRef<'r>) -> Result<Self, BoxDynError> {
        let value = <i64 as Decode<Postgres>>::decode(value)?;
        Self::new(value).ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "user id must be positive").into()
        })
    }
}

pub fn new_uuid_v7() -> Uuid {
    Uuid::now_v7()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::str::FromStr;

    #[test]
    fn new_id_returns_uuid_v7() {
        let id = new_uuid_v7();
        assert_eq!(id.get_version_num(), 7);
    }

    #[test]
    fn user_id_serializes_as_decimal_string() {
        let id = UserId::new(123456).expect("positive id");
        let value = serde_json::to_value(id).expect("serialize user id");
        assert_eq!(value, json!("123456"));
    }

    #[test]
    fn user_id_deserializes_from_decimal_string() {
        let id: UserId = serde_json::from_value(json!("123456")).expect("deserialize user id");
        assert_eq!(id.get(), 123456);
    }

    #[test]
    fn user_id_rejects_numbers_and_invalid_strings() {
        assert!(serde_json::from_value::<UserId>(json!(123456)).is_err());
        assert!(serde_json::from_value::<UserId>(json!("0")).is_err());
        assert!(serde_json::from_value::<UserId>(json!("-1")).is_err());
        assert!(serde_json::from_value::<UserId>(json!("not-a-number")).is_err());
    }

    #[test]
    fn user_id_display_and_from_str_use_decimal() {
        let id = UserId::from_str("42").expect("parse user id");
        assert_eq!(id.to_string(), "42");
        assert_eq!(id.get(), 42);
    }
}

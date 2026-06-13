use chrono::{DateTime, SecondsFormat, Utc};

pub fn now_utc() -> DateTime<Utc> {
    Utc::now()
}

pub fn to_rfc3339_utc(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_utc_ends_with_z() {
        let value = to_rfc3339_utc(now_utc());
        assert!(value.ends_with('Z'));
        assert!(value.contains('T'));
    }
}

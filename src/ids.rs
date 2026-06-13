use uuid::Uuid;

pub fn new_uuid_v7() -> Uuid {
    Uuid::now_v7()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_id_returns_uuid_v7() {
        let id = new_uuid_v7();
        assert_eq!(id.get_version_num(), 7);
    }
}

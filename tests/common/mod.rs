use sqlx::{Executor, PgPool};

pub async fn test_pool() -> PgPool {
    let url = std::env::var("TEST_DATABASE_URL")
        .expect("set TEST_DATABASE_URL for destructive database tests");
    let url =
        validate_test_database_url(&url).expect("TEST_DATABASE_URL must point to a test database");
    PgPool::connect(&url).await.expect("connect test database")
}

pub fn validate_test_database_url(url: &str) -> Result<String, String> {
    let database_name = url
        .rsplit_once('/')
        .map(|(_, database)| database.split('?').next().unwrap_or(database))
        .filter(|database| !database.is_empty())
        .ok_or_else(|| "database URL must include a database name".to_string())?;

    if database_name.contains("test") {
        Ok(url.to_string())
    } else {
        Err(format!(
            "refusing to reset non-test database '{database_name}'; use TEST_DATABASE_URL with a database name containing 'test'"
        ))
    }
}

pub async fn reset_database(pool: &PgPool) {
    pool.execute("drop schema public cascade; create schema public;")
        .await
        .expect("reset public schema");
}

#[cfg(test)]
mod tests {
    use super::validate_test_database_url;

    #[test]
    fn accepts_database_url_with_test_database_name() {
        let url = "postgres://nano:nano@localhost:5432/nano_chat_test";
        assert_eq!(validate_test_database_url(url).unwrap(), url);
    }

    #[test]
    fn rejects_database_url_without_test_database_name() {
        let error = validate_test_database_url("postgres://nano:nano@localhost:5432/nano_chat")
            .expect_err("non-test database should be rejected");
        assert!(error.contains("refusing to reset non-test database"));
    }
}

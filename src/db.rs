use sqlx::{PgPool, postgres::PgPoolOptions};

pub fn create_lazy_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .connect_lazy(database_url)
}

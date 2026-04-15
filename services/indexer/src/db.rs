use anyhow::{anyhow, Result};
use diesel::pg::PgConnection;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};

pub type PgPool = Pool<ConnectionManager<PgConnection>>;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

pub fn pool(url: &str) -> Result<PgPool> {
    let manager = ConnectionManager::<PgConnection>::new(url);
    Ok(Pool::builder().max_size(8).build(manager)?)
}

pub fn run_migrations(pool: &PgPool) -> Result<()> {
    let mut conn = pool.get()?;
    conn.run_pending_migrations(MIGRATIONS)
        .map_err(|e| anyhow!("run_pending_migrations: {e}"))?;
    Ok(())
}

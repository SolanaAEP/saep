use anyhow::Result;
use diesel::pg::PgConnection;
use diesel::r2d2::{ConnectionManager, Pool};

pub type PgPool = Pool<ConnectionManager<PgConnection>>;

pub fn pool(url: &str) -> Result<PgPool> {
    let manager = ConnectionManager::<PgConnection>::new(url);
    Ok(Pool::builder().max_size(8).build(manager)?)
}

fn main() {
    match trend_tv_lib::fetch_trending() {
        Ok(items) => {
            println!("OK: {} items", items.len());
            for it in items.iter().take(3) {
                println!("  [{}] {} — {}", it.category, it.name, it.lang);
            }
        }
        Err(e) => {
            println!("ERR: {e}");
            std::process::exit(1);
        }
    }
}

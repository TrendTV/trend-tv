use std::collections::BTreeMap;

fn main() {
    match trend_tv_lib::fetch_trending() {
        Ok(items) => {
            println!("OK: {} items", items.len());
            let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
            for it in &items {
                *counts.entry(it.category.as_str()).or_default() += 1;
            }
            for (cat, n) in counts {
                println!("  {cat:<12} {n}");
            }
        }
        Err(e) => {
            println!("ERR: {e}");
            std::process::exit(1);
        }
    }
}

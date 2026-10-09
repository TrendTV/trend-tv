// Trend TV — resilient trending fetcher.
// Design rule: the display never depends on a live fetch. This module
// reads/writes a local JSON cache; fetch failures only flip a staleness
// flag the frontend turns into a "PLEASE STAND BY" test card.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const FETCH_TTL_SECS: u64 = 3 * 3600;      // refresh cache every 3h
const SIGNAL_LOST_SECS: u64 = 24 * 3600;   // >24h without success → standby card
const BUNDLED_SNAPSHOT: &str = include_str!("../../src/snapshot.json");

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Item {
    pub name: String,
    pub desc: String,
    pub lang: String,
    pub stars: String,
    pub today: String,
    pub category: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct Cache {
    items: Vec<Item>,
    last_success: u64, // epoch secs of last successful fetch; 0 = never
    last_attempt: u64,
}

#[derive(Debug, Serialize)]
pub struct FeedPayload {
    items: Vec<Item>,
    signal_lost: bool,
}

pub struct AppState {
    cache: Mutex<Cache>,
    refreshing: AtomicBool,
    session_refreshed: AtomicBool, // first get_feed of the session always fetches
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn cache_path() -> PathBuf {
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trend-tv");
    let _ = fs::create_dir_all(&dir);
    dir.join("feed-cache.json")
}

fn load_cache() -> Cache {
    if let Ok(text) = fs::read_to_string(cache_path()) {
        if let Ok(c) = serde_json::from_str::<Cache>(&text) {
            return c;
        }
    }
    Cache::default()
}

fn save_cache(c: &Cache) {
    if let Ok(text) = serde_json::to_string_pretty(c) {
        let _ = fs::write(cache_path(), text);
    }
}

/// Same keyword rules as the frontend fallback.
fn categorize(lang: &str, desc: &str) -> String {
    let t = format!("{} {}", lang, desc).to_lowercase();
    let has = |ws: &[&str]| ws.iter().any(|w| t.contains(w));
    if has(&["audio", "music", "sound", "synth", "midi", "dsp", "spotify"]) {
        return "audio".into();
    }
    if has(&["game", "godot", "unity", "unreal", "engine", "bevy"]) {
        return "games".into();
    }
    if has(&["css", "ui", "design", "frontend", "tailwind", "react", "vue", "svelte",
             "component", "animation", "three.js", "webgl", "shader", "canvas", "figma"]) {
        return "visual".into();
    }
    if has(&["cli", "terminal", "shell", "linter", "formatter", "git ", "devtools",
             "debug", "build tool", "bundler", "compiler"]) {
        return "devtools".into();
    }
    "production".into()
}

fn parse_trending(html_text: &str, out: &mut Vec<Item>, seen: &mut Vec<String>) {
    let doc = scraper::Html::parse_document(html_text);
    let row_sel = scraper::Selector::parse("article.Box-row").unwrap();
    let a_sel = scraper::Selector::parse("h2 a").unwrap();
    let p_sel = scraper::Selector::parse("p").unwrap();
    let lang_sel = scraper::Selector::parse("[itemprop=\"programmingLanguage\"]").unwrap();
    let star_sel = scraper::Selector::parse("a.Link--muted").unwrap();
    let today_sel = scraper::Selector::parse("span.d-inline-block.float-sm-right").unwrap();

    for row in doc.select(&row_sel) {
        let Some(a) = row.select(&a_sel).next() else { continue };
        let name = a.value().attr("href").unwrap_or("").trim_matches('/').to_string();
        if name.is_empty() || seen.contains(&name) { continue; }
        seen.push(name.clone());
        let txt = |sel: &scraper::Selector| row.select(sel).next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();
        let desc = txt(&p_sel);
        let lang = txt(&lang_sel);
        let stars = txt(&star_sel);
        let today = txt(&today_sel);
        let category = categorize(&lang, &desc);
        out.push(Item { name, desc, lang, stars, today, category });
    }
}

/// Language-specific trending feeds → dedicated TV channels.
/// (url slug, category id) — fetched every refresh, merged & deduped.
const LANG_FEEDS: &[(&str, &str)] = &[
    ("rust", "rust"),
    ("python", "python"),
    ("typescript", "typescript"),
    ("javascript", "javascript"),
    ("go", "go"),
    ("c%2B%2B", "cpp"),
    ("c", "cpp"),
    ("java", "jvm"),
    ("kotlin", "jvm"),
    ("swift", "swift"),
    ("ruby", "ruby"),
    ("php", "php"),
    ("dart", "dart"),
    ("zig", "zig"),
];

/// Fetch overall daily+weekly plus every language channel, merge & dedupe.
/// Any single-source failure is tolerated — caller keeps the old cache
/// only if EVERYTHING fails. This can never crash the app.
pub fn fetch_trending() -> Result<Vec<Item>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("trend-tv/0.3")
        .build()
        .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut any_ok = false;

    let mut pull = |url: String, forced_cat: Option<&str>, items: &mut Vec<Item>, seen: &mut Vec<String>| -> bool {
        match client.get(&url).send() {
            Ok(resp) if resp.status().is_success() => {
                match resp.text() {
                    Ok(body) => {
                        let before = items.len();
                        parse_trending(&body, items, seen);
                        // language feeds override the keyword category
                        if let Some(cat) = forced_cat {
                            for it in items[before..].iter_mut() {
                                it.category = cat.to_string();
                            }
                        }
                        true
                    }
                    Err(_) => false,
                }
            }
            Ok(resp) => { eprintln!("[fetch] {url} -> HTTP {}", resp.status()); false }
            Err(e) => { eprintln!("[fetch] {url} -> {e}"); false }
        }
    };

    for url in [
        "https://github.com/trending?since=daily".to_string(),
        "https://github.com/trending?since=weekly".to_string(),
    ] {
        if pull(url, None, &mut items, &mut seen) { any_ok = true; }
    }
    for (slug, cat) in LANG_FEEDS {
        let url = format!("https://github.com/trending/{slug}?since=daily");
        if pull(url, Some(cat), &mut items, &mut seen) { any_ok = true; }
        // be polite to github.com — small gap between channel fetches
        std::thread::sleep(Duration::from_millis(300));
    }

    if any_ok && !items.is_empty() { Ok(items) } else { Err("all sources failed".into()) }
}

fn spawn_refresh(state: &Arc<AppState>) {
    if state.refreshing.swap(true, Ordering::SeqCst) {
        return; // already refreshing
    }
    let state = Arc::clone(state);
    std::thread::spawn(move || {
        let attempt = now();
        match fetch_trending() {
            Ok(items) => {
                let mut cache = state.cache.lock().unwrap();
                cache.items = items;
                cache.last_success = now();
                cache.last_attempt = attempt;
                save_cache(&cache);
                eprintln!("[fetch] cache refreshed");
            }
            Err(e) => {
                eprintln!("[fetch] refresh failed: {e} - keeping old cache");
                let mut cache = state.cache.lock().unwrap();
                cache.last_attempt = attempt;
                save_cache(&cache);
            }
        }
        state.refreshing.store(false, Ordering::SeqCst);
    });
}

fn build_payload(cache: &Cache) -> FeedPayload {
    let items = if cache.items.is_empty() {
        serde_json::from_str::<Vec<Item>>(BUNDLED_SNAPSHOT).unwrap_or_default()
    } else {
        cache.items.clone()
    };
    let signal_lost = now().saturating_sub(cache.last_success) > SIGNAL_LOST_SECS
        && cache.last_attempt > cache.last_success;
    FeedPayload { items, signal_lost }
}

#[tauri::command]
fn get_feed(state: tauri::State<'_, Arc<AppState>>) -> FeedPayload {
    // fresh crawl on every app open (first call of the session)
    let first_call = !state.session_refreshed.swap(true, Ordering::SeqCst);
    let stale = {
        let cache = state.cache.lock().unwrap();
        now().saturating_sub(cache.last_attempt) > FETCH_TTL_SECS
    };
    if first_call || stale {
        spawn_refresh(state.inner());
    }
    let cache = state.cache.lock().unwrap();
    build_payload(&cache)
}

#[tauri::command]
fn refresh_now(state: tauri::State<'_, Arc<AppState>>) {
    spawn_refresh(state.inner());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(AppState {
            cache: Mutex::new(load_cache()),
            refreshing: AtomicBool::new(false),
            session_refreshed: AtomicBool::new(false),
        }))
        .invoke_handler(tauri::generate_handler![get_feed, refresh_now])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use chrono::Utc;
use std::collections::HashMap;
use base64::{Engine as _, engine::general_purpose};
use lofty::file::{TaggedFileExt, AudioFile};

#[derive(Debug, Serialize, Deserialize)]
struct LibraryData {
    songs: Vec<Song>,
    settings: Settings,
}

#[derive(Debug, Serialize, Deserialize)]
struct Song {
    id: String,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    lyrics: String,
    #[serde(rename = "syncedLyrics", skip_serializing_if = "Option::is_none")]
    synced_lyrics: Option<Vec<LyricLine>>,
    #[serde(rename = "filePath")]
    file_path: String,
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(rename = "fileSize")]
    file_size: u64,
    #[serde(rename = "lastModified")]
    last_modified: u64,
    #[serde(rename = "addedAt", skip_serializing_if = "Option::is_none")]
    added_at: Option<String>,
    #[serde(rename = "playCount", skip_serializing_if = "Option::is_none")]
    play_count: Option<u32>,
    #[serde(rename = "lastPlayed", skip_serializing_if = "Option::is_none")]
    last_played: Option<String>,
    available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LyricLine {
    time: f64,
    text: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Settings {
    #[serde(skip_serializing_if = "Option::is_none")]
    volume: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LoadResult {
    success: bool,
    library: LibraryData,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SaveResult {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FilePathResult {
    success: bool,
    data: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SaveAudioResult {
    success: bool,
    #[serde(rename = "filePath", skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ValidationResult {
    success: bool,
    results: Vec<PathValidationResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PathValidationResult {
    id: String,
    exists: bool,
}

// Metadata cache structure - stores parsed metadata to avoid re-parsing
#[derive(Debug, Serialize, Deserialize)]
struct MetadataCache {
    entries: HashMap<String, CachedMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedMetadata {
    title: String,
    artist: String,
    album: String,
    duration: f64,
    lyrics: String,
    #[serde(rename = "syncedLyrics", skip_serializing_if = "Option::is_none")]
    synced_lyrics: Option<Vec<LyricLine>>,
    #[serde(rename = "coverData", skip_serializing_if = "Option::is_none")]
    cover_data: Option<String>, // Base64 encoded cover image
    #[serde(rename = "coverMime", skip_serializing_if = "Option::is_none")]
    cover_mime: Option<String>,
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(rename = "fileSize")]
    file_size: u64,
    #[serde(rename = "lastModified")]
    last_modified: u64,
}

#[tauri::command]
async fn read_file(file_path: String) -> Result<FilePathResult, String> {
    println!("📖 Reading file: {}", file_path);

    // Check if file exists and get metadata
    let metadata = match fs::metadata(&file_path) {
        Ok(meta) => {
            println!("✅ File exists, size: {} bytes", meta.len());
            meta
        },
        Err(e) => {
            println!("❌ Failed to get file metadata: {}", e);
            return Ok(FilePathResult {
                success: false,
                data: vec![],
                error: Some(format!("Failed to get metadata: {}", e)),
            });
        }
    };

    // Check if it's a symlink
    if metadata.is_symlink() {
        println!("🔗 File is a symlink");
        match fs::read_link(&file_path) {
            Ok(target) => {
                println!("🎯 Symlink target: {:?}", target);
            },
            Err(e) => {
                println!("❌ Failed to read symlink target: {}", e);
            }
        }
    }

    match fs::read(&file_path) {
        Ok(data) => {
            println!("✅ Successfully read {} bytes", data.len());
            Ok(FilePathResult {
                success: true,
                data,
                error: None,
            })
        },
        Err(e) => {
            println!("❌ Failed to read file: {}", e);
            Ok(FilePathResult {
                success: false,
                data: vec![],
                error: Some(e.to_string()),
            })
        },
    }
}

#[tauri::command]
async fn check_file_exists(file_path: String) -> bool {
    PathBuf::from(&file_path).exists()
}

#[tauri::command]
async fn get_app_data_path(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_library(app: tauri::AppHandle) -> Result<LoadResult, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| {
        eprintln!("Failed to get app data dir: {}", e);
        e.to_string()
    })?;

    println!("📁 App data directory: {:?}", app_data_dir);

    let library_path = app_data_dir.join("library.json");
    println!("📖 Loading library from: {:?}", library_path);
    println!("📄 File exists: {:?}", library_path.exists());

    if !library_path.exists() {
        println!("⚠️ Library file does not exist, returning empty library");
        return Ok(LoadResult {
            success: true,
            library: LibraryData {
                songs: vec![],
                settings: Settings { volume: None },
            },
            error: None,
        });
    }

    let content = fs::read_to_string(&library_path).map_err(|e| {
        eprintln!("Failed to read library file: {}", e);
        e.to_string()
    })?;

    println!("📄 Library file size: {} bytes", content.len());

    let library: LibraryData = serde_json::from_str(&content).map_err(|e| {
        eprintln!("Failed to parse library JSON: {}", e);
        e.to_string()
    })?;

    println!("✅ Library loaded successfully with {} songs", library.songs.len());

    Ok(LoadResult {
        success: true,
        library,
        error: None,
    })
}

#[tauri::command]
async fn save_library(
    app: tauri::AppHandle,
    library: LibraryData,
) -> Result<SaveResult, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| {
        eprintln!("Failed to get app data dir: {}", e);
        e.to_string()
    })?;

    println!("📁 App data directory: {:?}", app_data_dir);

    // Ensure directory exists
    fs::create_dir_all(&app_data_dir).map_err(|e| {
        eprintln!("Failed to create directory: {}", e);
        e.to_string()
    })?;

    let library_path = app_data_dir.join("library.json");
    println!("💾 Saving library to: {:?}", library_path);
    println!("📊 Library has {} songs", library.songs.len());

    let json = serde_json::to_string_pretty(&library).map_err(|e| {
        eprintln!("Failed to serialize library: {}", e);
        e.to_string()
    })?;

    fs::write(&library_path, json).map_err(|e| {
        eprintln!("Failed to write library file: {}", e);
        e.to_string()
    })?;

    println!("✅ Library saved successfully!");
    println!("📄 File exists after save: {:?}", library_path.exists());

    Ok(SaveResult {
        success: true,
        error: None,
    })
}

#[tauri::command]
async fn validate_file_path(file_path: String) -> bool {
    PathBuf::from(&file_path).exists()
}

#[tauri::command]
async fn save_audio_file(
    app: tauri::AppHandle,
    source_path: String,
    file_name: String,
) -> Result<SaveAudioResult, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let audio_dir = app_data_dir.join("audio");
    fs::create_dir_all(&audio_dir).map_err(|e| e.to_string())?;

    let unique_name = format!("{}-{}", Utc::now().timestamp_millis(), file_name);
    let audio_path = audio_dir.join(&unique_name);

    // Try to create symlink first
    match std::os::unix::fs::symlink(&source_path, &audio_path) {
        Ok(_) => {
            println!("✅ Symlink created: {:?} -> {:?}", audio_path, source_path);
            Ok(SaveAudioResult {
                success: true,
                file_path: Some(audio_path.to_string_lossy().to_string()),
                method: Some("symlink".to_string()),
                error: None,
            })
        }
        Err(e) => {
            // Symlink failed, fall back to copy
            println!(
                "⚠️ Symlink failed, copying file instead: {}",
                e.to_string()
            );
            fs::copy(&source_path, &audio_path).map_err(|e| e.to_string())?;
            println!("✅ File copied: {:?}", audio_path);
            Ok(SaveAudioResult {
                success: true,
                file_path: Some(audio_path.to_string_lossy().to_string()),
                method: Some("copy".to_string()),
                error: None,
            })
        }
    }
}

#[tauri::command]
async fn save_audio_file_from_buffer(
    app: tauri::AppHandle,
    file_name: String,
    file_data: Vec<u8>,
) -> Result<SaveAudioResult, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let audio_dir = app_data_dir.join("audio");
    fs::create_dir_all(&audio_dir).map_err(|e| e.to_string())?;

    let unique_name = format!("{}-{}", Utc::now().timestamp_millis(), file_name);
    let audio_path = audio_dir.join(&unique_name);

    fs::write(&audio_path, file_data).map_err(|e| e.to_string())?;

    println!("✅ File saved from buffer: {:?}", audio_path);
    Ok(SaveAudioResult {
        success: true,
        file_path: Some(audio_path.to_string_lossy().to_string()),
        method: Some("copy".to_string()),
        error: None,
    })
}

#[tauri::command]
async fn delete_audio_file(file_path: String) -> Result<SaveResult, String> {
    if file_path.is_empty() {
        return Ok(SaveResult {
            success: false,
            error: Some("File path is empty".to_string()),
        });
    }

    let path = PathBuf::from(&file_path);

    if !path.exists() {
        println!("⚠️ File does not exist, skipping deletion: {:?}", file_path);
        return Ok(SaveResult {
            success: true,
            error: None,
        });
    }

    fs::remove_file(&path).map_err(|e| e.to_string())?;
    println!("✅ File/symlink deleted: {:?}", file_path);

    Ok(SaveResult {
        success: true,
        error: None,
    })
}

#[tauri::command]
async fn validate_all_paths(songs: Vec<Song>) -> Result<ValidationResult, String> {
    let results = songs
        .into_iter()
        .map(|song| PathValidationResult {
            id: song.id,
            exists: if song.file_path.is_empty() {
                false
            } else {
                PathBuf::from(&song.file_path).exists()
            },
        })
        .collect();

    Ok(ValidationResult {
        success: true,
        results,
        error: None,
    })
}

// Get metadata cache file path
fn get_metadata_cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("metadata_cache.json"))
}

#[tauri::command]
async fn load_metadata_cache(app: tauri::AppHandle) -> Result<MetadataCache, String> {
    let cache_path = get_metadata_cache_path(&app)?;

    if !cache_path.exists() {
        println!("📭 Metadata cache does not exist, returning empty cache");
        return Ok(MetadataCache {
            entries: HashMap::new(),
        });
    }

    let content = fs::read_to_string(&cache_path).map_err(|e| {
        eprintln!("Failed to read metadata cache: {}", e);
        e.to_string()
    })?;

    let cache: MetadataCache = serde_json::from_str(&content).map_err(|e| {
        eprintln!("Failed to parse metadata cache JSON: {}", e);
        e.to_string()
    })?;

    println!("✅ Metadata cache loaded with {} entries", cache.entries.len());
    Ok(cache)
}

#[tauri::command]
async fn save_metadata_cache(
    app: tauri::AppHandle,
    cache: MetadataCache,
) -> Result<SaveResult, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;

    let cache_path = get_metadata_cache_path(&app)?;

    let json = serde_json::to_string_pretty(&cache).map_err(|e| e.to_string())?;
    fs::write(&cache_path, json).map_err(|e| e.to_string())?;

    println!("✅ Metadata cache saved with {} entries", cache.entries.len());
    Ok(SaveResult {
        success: true,
        error: None,
    })
}

#[tauri::command]
async fn get_audio_url(file_path: String) -> Result<String, String> {
    println!("🎵 Getting audio URL for: {}", file_path);

    // Check if file exists
    if !PathBuf::from(&file_path).exists() {
        return Err("File does not exist".to_string());
    }

    // Return http://localhost/audio/ URL
    // We'll use Tauri's built-in HTTP server or a custom handler
    let url = format!("http://localhost/audio/{}", file_path);
    println!("✅ Audio URL: {}", url);
    Ok(url)
}

#[tauri::command]
async fn get_metadata_for_song(
    app: tauri::AppHandle,
    song_id: String,
) -> Result<Option<CachedMetadata>, String> {
    let cache = load_metadata_cache(app).await?;
    Ok(cache.entries.get(&song_id).cloned())
}

#[derive(Debug, Serialize, Deserialize)]
struct ParsedMetadataResult {
    success: bool,
    metadata: Option<ParsedMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ParsedMetadata {
    title: String,
    artist: String,
    album: String,
    duration: f64,
    lyrics: String,
    #[serde(rename = "syncedLyrics", skip_serializing_if = "Option::is_none")]
    synced_lyrics: Option<Vec<LyricLine>>,
    #[serde(rename = "coverData", skip_serializing_if = "Option::is_none")]
    cover_data: Option<String>, // Base64 encoded
    #[serde(rename = "coverMime", skip_serializing_if = "Option::is_none")]
    cover_mime: Option<String>,
}

#[tauri::command]
async fn parse_audio_metadata(file_path: String) -> Result<ParsedMetadataResult, String> {
    println!("🎵 [Rust] Parsing metadata for: {}", file_path);

    // Check if file exists
    if !PathBuf::from(&file_path).exists() {
        return Ok(ParsedMetadataResult {
            success: false,
            metadata: None,
            error: Some("File does not exist".to_string()),
        });
    }

    // Try to parse the audio file with lofty
    let tagged_file = match lofty::read_from_path(&file_path) {
        Ok(file) => file,
        Err(e) => {
            println!("❌ [Rust] Failed to read audio file: {}", e);
            return Ok(ParsedMetadataResult {
                success: false,
                metadata: None,
                error: Some(format!("Failed to read audio file: {}", e)),
            });
        }
    };

    let properties = tagged_file.properties();
    let duration = properties.duration().as_secs_f64();

    // Extract metadata from tags
    let mut title = String::new();
    let mut artist = String::new();
    let mut album = String::new();
    let mut lyrics = String::new();
    let mut cover_data: Option<String> = None;
    let mut cover_mime: Option<String> = None;

    // Iterate through tags to extract metadata
    if let Some(tag) = tagged_file.first_tag() {
        // Extract title, artist, album, lyrics from tag items
        for item in tag.items() {
            // Use debug format to get key representation
            let key_debug = format!("{:?}", item.key());

            if let Some(text) = item.value().text() {
                let text_str = text.to_string();

                // Match keys by checking debug representation
                if key_debug.contains("Title") && title.is_empty() {
                    title = text_str;
                } else if key_debug.contains("Artist") && artist.is_empty() {
                    artist = text_str;
                } else if key_debug.contains("Album") && album.is_empty() {
                    album = text_str;
                } else if (key_debug.contains("Lyrics") || key_debug.contains("USLT")) && lyrics.is_empty() {
                    lyrics = text_str;
                }
            }
        }

        // Extract cover art
        for picture in tag.pictures() {
            if let Some(mime) = picture.mime_type() {
                cover_mime = Some(mime.to_string());
            }
            cover_data = Some(general_purpose::STANDARD.encode(picture.data()));
            break; // Use first cover
        }
    }

    // Fallback to filename if no title
    if title.is_empty() {
        if let Some(file_name) = PathBuf::from(&file_path).file_stem() {
            title = file_name.to_string_lossy().to_string();
        }
    }

    // Fallback for artist
    if artist.is_empty() {
        artist = "Unknown Artist".to_string();
    }

    // Fallback for album
    if album.is_empty() {
        album = "Unknown Album".to_string();
    }

    println!("✅ [Rust] Parsed: {} - {} - {} ({}s)", title, artist, album, duration);

    Ok(ParsedMetadataResult {
        success: true,
        metadata: Some(ParsedMetadata {
            title,
            artist,
            album,
            duration,
            lyrics,
            synced_lyrics: None, // TODO: Implement synced lyrics parsing
            cover_data,
            cover_mime,
        }),
        error: None,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Initialize dialog plugin
            app.handle().plugin(tauri_plugin_dialog::init())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            check_file_exists,
            get_app_data_path,
            load_library,
            save_library,
            validate_file_path,
            save_audio_file,
            save_audio_file_from_buffer,
            delete_audio_file,
            validate_all_paths,
            load_metadata_cache,
            save_metadata_cache,
            get_metadata_for_song,
            parse_audio_metadata,
            get_audio_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

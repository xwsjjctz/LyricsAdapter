use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use chrono::Utc;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    synced_lyrics: Option<Vec<LyricLine>>,
    file_path: String,
    file_name: String,
    file_size: u64,
    last_modified: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    added_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    play_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_played: Option<String>,
    available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
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

#[tauri::command]
async fn read_file(file_path: String) -> Result<FilePathResult, String> {
    match fs::read(&file_path) {
        Ok(data) => Ok(FilePathResult {
            success: true,
            data,
            error: None,
        }),
        Err(e) => Ok(FilePathResult {
            success: false,
            data: vec![],
            error: Some(e.to_string()),
        }),
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
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let library_path = app_data_dir.join("library.json");

    if !library_path.exists() {
        return Ok(LoadResult {
            success: true,
            library: LibraryData {
                songs: vec![],
                settings: Settings { volume: None },
            },
            error: None,
        });
    }

    let content = fs::read_to_string(&library_path).map_err(|e| e.to_string())?;
    let library: LibraryData = serde_json::from_str(&content).map_err(|e| e.to_string())?;

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
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // Ensure directory exists
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;

    let library_path = app_data_dir.join("library.json");
    let json = serde_json::to_string_pretty(&library).map_err(|e| e.to_string())?;

    fs::write(&library_path, json).map_err(|e| e.to_string())?;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

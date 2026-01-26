"""Flask API服务 - 音乐搜索、下载和元数据处理

提供以下功能：
- 音乐搜索
- 音乐下载（带元数据）
- 元数据管理
"""

import json
import os
import threading
import time
from io import BytesIO
from typing import Optional

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_file
from werkzeug.utils import secure_filename

from audio_resource import download_file
from get_audio_resource import GetAudioResource
from metadata_processing import AudioProcessing
from utils import qq_music_metadata

# 加载环境变量
load_dotenv()
COOKIE = os.environ.get("QQ_MUSIC_COOKIE")
UPLOAD_FOLDER = "downloads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100MB max file size

# CORS支持
@app.after_request
def after_request(response):
    response.headers.add("Access-Control-Allow-Origin", "*")
    response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
    response.headers.add("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS")
    return response


@app.route("/", methods=["GET"])
def index():
    """API首页"""
    return jsonify({
        "name": "LyricsAdapter API",
        "version": "2.0.0",
        "description": "音乐搜索、下载和元数据处理API",
        "endpoints": {
            "GET /": "API信息",
            "GET /search": "搜索音乐",
            "GET /download": "下载音乐并添加元数据",
            "GET /song/<mid>": "获取歌曲详情",
            "GET /lyrics/<mid>": "获取歌词",
            "GET /cover/<album_mid>": "获取封面",
            "POST /metadata/check": "检查音频文件元数据",
            "POST /metadata/add": "添加元数据到音频文件",
            "POST /metadata/update": "更新音频文件元数据",
            "POST /metadata/delete": "删除音频文件元数据",
            "GET /frontend": "前端页面"
        }
    })


@app.route("/search", methods=["GET"])
def search_music():
    """搜索音乐

    Parameters:
        text: 搜索关键词
        limit: 返回数量（默认20）

    Returns:
        JSON: 搜索结果列表
    """
    search_text = request.args.get("text", type=str)
    limit = request.args.get("limit", default=20, type=int)

    if not search_text:
        return jsonify(error="Missing 'text' parameter"), 400

    try:
        qq_music = qq_music_metadata.QQMusicMetadata()
        qq_music._cookies = qq_music.set_cookie(COOKIE)
        list_search = qq_music.search_music(search_text, limit)

        results = []
        for item in list_search:
            results.append({
                "mid": item.get("songmid", ""),
                "title": item.get("songname", ""),
                "artist": item["singer"][0]["name"] if item.get("singer") else "",
                "album": item.get("albumname", ""),
                "album_mid": item.get("albummid", ""),
                "duration": item.get("interval", 0),
            })

        return jsonify(results=results, count=len(results))

    except Exception as e:
        return jsonify(error=f"Search failed: {str(e)}"), 500


@app.route("/download", methods=["GET"])
def download_music():
    """下载音乐并添加元数据，返回文件流供浏览器下载

    Parameters:
        mid: 音乐ID（必需）
        qlt: 音质（128/320/flac，默认flac）
        title: 歌曲名（可选，用于优先使用搜索结果中的信息）
        artist: 歌手（可选，用于优先使用搜索结果中的信息）
        album_mid: 专辑ID（可选，用于优先使用搜索结果中的信息）

    Returns:
        File: 音频文件流
    """
    mid = request.args.get("mid", type=str)
    quality = request.args.get("qlt", default="flac", type=str)
    title = request.args.get("title", type=str)
    artist = request.args.get("artist", type=str)
    album_mid = request.args.get("album_mid", type=str)

    if not mid:
        return jsonify(error="Missing 'mid' parameter"), 400

    if quality not in ["128", "320", "flac"]:
        return jsonify(error="Invalid quality. Must be 128, 320, or flac"), 400

    try:
        qq_music = GetAudioResource(COOKIE, "")

        # 如果前端提供了完整的歌曲信息，直接使用
        if title and artist:
            song_name = title
            singer = artist
            # 如果没有album_mid，尝试获取
            if not album_mid:
                song_info = qq_music.get_song_info(mid)
                album_mid = song_info.get("albummid", "")
        else:
            # 否则通过API获取歌曲信息
            song_info = qq_music.get_song_info(mid)
            if not song_info or song_info.get("singer") == "Unknown":
                return jsonify(error="Failed to get song information"), 500
            singer = song_info["singer"]
            song_name = song_info["songname"]
            album_mid = song_info.get("albummid", "")

        ext = "flac" if quality == "flac" else "mp3"
        filename = f"{singer} - {song_name}.{ext}"

        # 使用临时文件路径
        temp_dir = app.config["UPLOAD_FOLDER"]
        os.makedirs(temp_dir, exist_ok=True)
        filepath = os.path.join(temp_dir, filename)

        # 获取下载链接
        audio_url = qq_music.audio_get(mid, quality)
        if not audio_url or audio_url == "Error":
            return jsonify(error="Failed to get audio URL"), 500

        # 下载音频到临时文件
        download_file(audio_url, filepath)

        # 获取元数据
        lyrics = qq_music.audio_lyrics_get(mid)
        cover = qq_music.audio_cover_get(album_mid) if album_mid else None

        # 保存封面到临时文件
        cover_path = None
        if cover:
            cover_path = os.path.join(temp_dir, f"{mid}_cover.jpg")
            with open(cover_path, "wb") as f:
                f.write(cover)

        # 添加元数据
        meta = AudioProcessing(
            audio=filepath,
            title=song_name,
            artist=singer,
            lyrics=lyrics,
            cover=cover_path
        )
        meta.metadata_processing()

        # 删除临时封面文件
        if cover_path and os.path.exists(cover_path):
            os.remove(cover_path)

        # 返回文件给浏览器下载
        # 在后台线程延迟删除临时文件
        def cleanup_temp_file():
            time.sleep(5)  # 等待5秒确保文件已发送
            try:
                if os.path.exists(filepath):
                    os.remove(filepath)
            except Exception as e:
                print(f"清理临时文件失败: {e}")

        cleanup_thread = threading.Thread(target=cleanup_temp_file)
        cleanup_thread.daemon = True
        cleanup_thread.start()

        return send_file(
            filepath,
            as_attachment=True,
            download_name=filename,
            mimetype="audio/flac" if quality == "flac" else "audio/mpeg"
        )

    except Exception as e:
        return jsonify(error=f"Download failed: {str(e)}"), 500


@app.route("/song/<mid>", methods=["GET"])
def get_song_info(mid: str):
    """获取歌曲详情

    Parameters:
        mid: 音乐ID

    Returns:
        JSON: 歌曲详情
    """
    try:
        qq_music = GetAudioResource(COOKIE, "")
        song_info = qq_music.get_song_info(mid)

        if not song_info or song_info.get("singer") == "Unknown":
            return jsonify(error="Song not found"), 404

        return jsonify({
            "mid": mid,
            "title": song_info.get("songname", ""),
            "artist": song_info.get("singer", ""),
            "album_mid": song_info.get("albummid", "")
        })

    except Exception as e:
        return jsonify(error=f"Failed to get song info: {str(e)}"), 500


@app.route("/lyrics/<mid>", methods=["GET"])
def get_lyrics(mid: str):
    """获取歌词

    Parameters:
        mid: 音乐ID

    Returns:
        JSON: 歌词内容
    """
    try:
        qq_music = qq_music_metadata.QQMusicMetadata()
        qq_music._cookies = qq_music.set_cookie(COOKIE)
        lyrics = qq_music.get_lyrics(mid)

        return jsonify(lyrics=lyrics)

    except Exception as e:
        return jsonify(error=f"Failed to get lyrics: {str(e)}"), 500


@app.route("/cover/<album_mid>", methods=["GET"])
def get_cover(album_mid: str):
    """获取封面图片

    Parameters:
        album_mid: 专辑ID

    Returns:
        Image: 封面图片
    """
    try:
        qq_music = GetAudioResource(COOKIE, "")
        cover_data = qq_music.audio_cover_get(album_mid)

        if not cover_data:
            return jsonify(error="Cover not found"), 404

        return send_file(
            BytesIO(cover_data),
            mimetype="image/jpeg",
            as_attachment=False,
            download_name=f"{album_mid}.jpg"
        )

    except Exception as e:
        return jsonify(error=f"Failed to get cover: {str(e)}"), 500


@app.route("/metadata/check", methods=["POST"])
def metadata_check():
    """检查音频文件元数据

    Request Body (multipart/form-data):
        audio: 音频文件

    Returns:
        JSON: 元数据检查结果
    """
    if "audio" not in request.files:
        return jsonify(error="No audio file provided"), 400

    file = request.files["audio"]
    if file.filename == "":
        return jsonify(error="No file selected"), 400

    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        file.save(filepath)

        processor = AudioProcessing(audio=filepath)
        title, artist, lyrics, cover = processor.metadata_check()

        os.remove(filepath)

        return jsonify({
            "metadata": {
                "has_title": title,
                "has_artist": artist,
                "has_lyrics": lyrics,
                "has_cover": cover
            }
        })

    except Exception as e:
        return jsonify(error=f"Check failed: {str(e)}"), 500


@app.route("/metadata/add", methods=["POST"])
def metadata_add():
    """添加元数据到音频文件（只填充缺失字段）

    Request Body (multipart/form-data):
        audio: 音频文件
        title: 标题（可选）
        artist: 艺术家（可选）
        lyrics: 歌词（可选）
        cover: 封面图片（可选）

    Returns:
        JSON: 处理结果
    """
    if "audio" not in request.files:
        return jsonify(error="No audio file provided"), 400

    file = request.files["audio"]
    if file.filename == "":
        return jsonify(error="No file selected"), 400

    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        file.save(filepath)

        # 处理封面
        cover_path = None
        if "cover" in request.files and request.files["cover"].filename:
            cover_file = request.files["cover"]
            cover_path = os.path.join(app.config["UPLOAD_FOLDER"], f"cover_{filename}.jpg")
            cover_file.save(cover_path)

        # 处理元数据
        processor = AudioProcessing(
            audio=filepath,
            title=request.form.get("title"),
            artist=request.form.get("artist"),
            lyrics=request.form.get("lyrics"),
            cover=cover_path
        )
        success = processor.metadata_processing()

        # 清理临时封面文件
        if cover_path and os.path.exists(cover_path):
            os.remove(cover_path)

        if success:
            return jsonify({
                "success": True,
                "message": "Metadata added successfully",
                "filename": filename
            })
        else:
            return jsonify(error="Failed to add metadata"), 500

    except Exception as e:
        return jsonify(error=f"Add failed: {str(e)}"), 500


@app.route("/metadata/update", methods=["POST"])
def metadata_update():
    """更新音频文件元数据

    Request Body (multipart/form-data):
        audio: 音频文件
        title: 标题（可选）
        artist: 艺术家（可选）
        lyrics: 歌词（可选）
        cover: 封面图片（可选）
        overwrite: 是否覆盖现有元数据（true/false，默认false）

    Returns:
        JSON: 处理结果
    """
    if "audio" not in request.files:
        return jsonify(error="No audio file provided"), 400

    file = request.files["audio"]
    if file.filename == "":
        return jsonify(error="No file selected"), 400

    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        file.save(filepath)

        # 处理封面
        cover_path = None
        if "cover" in request.files and request.files["cover"].filename:
            cover_file = request.files["cover"]
            cover_path = os.path.join(app.config["UPLOAD_FOLDER"], f"cover_{filename}.jpg")
            cover_file.save(cover_path)

        overwrite = request.form.get("overwrite", "false").lower() == "true"

        processor = AudioProcessing(
            audio=filepath,
            title=request.form.get("title"),
            artist=request.form.get("artist"),
            lyrics=request.form.get("lyrics"),
            cover=cover_path
        )
        success = processor.metadata_update(overwrite=overwrite)

        # 清理临时封面文件
        if cover_path and os.path.exists(cover_path):
            os.remove(cover_path)

        if success:
            return jsonify({
                "success": True,
                "message": "Metadata updated successfully",
                "filename": filename
            })
        else:
            return jsonify(error="Failed to update metadata"), 500

    except Exception as e:
        return jsonify(error=f"Update failed: {str(e)}"), 500


@app.route("/metadata/delete", methods=["POST"])
def metadata_delete():
    """删除音频文件元数据

    Request Body (multipart/form-data):
        audio: 音频文件

    Returns:
        JSON: 处理结果
    """
    if "audio" not in request.files:
        return jsonify(error="No audio file provided"), 400

    file = request.files["audio"]
    if file.filename == "":
        return jsonify(error="No file selected"), 400

    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        file.save(filepath)

        processor = AudioProcessing(audio=filepath)
        success = processor.metadata_delete()

        if success:
            os.remove(filepath)

            return jsonify({
                "success": True,
                "message": "Metadata deleted successfully"
            })
        else:
            return jsonify(error="Failed to delete metadata"), 500

    except Exception as e:
        return jsonify(error=f"Delete failed: {str(e)}"), 500


@app.route("/frontend", methods=["GET"])
def frontend():
    """前端页面"""
    return send_file("templates/index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)

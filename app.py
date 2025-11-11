import os

from dotenv import load_dotenv
from flask import Flask, jsonify, request

from audio_resource import download_file
from get_audio_resource import GetAudioResource
from metadata_processing import AudioProcessing
from utils import qq_music_metadata

load_dotenv()
cookie = os.environ.get("QQ_MUSIC_COOKIE")

app = Flask(__name__)


@app.route("/", methods=["GET"])
def radio_station_recommendation():
    pass


@app.route("/search", methods=["GET"])
def search_music():
    search = request.args.get("text", type=str)
    qq_music = qq_music_metadata.QQMusicMetadata()
    qq_music._cookies = qq_music.set_cookie(cookie)
    list_search = qq_music.search_music(search, 20)
    songinfo = [
        (item["songmid"], item["songname"], item["singer"][0]["name"])
        for item in list_search
    ]
    return jsonify(results=songinfo)


@app.route("/download", methods=["GET"])
def download_music():
    """
    通过音乐的mid下载音乐并添加元数据
    请求参数:
    - mid: 音乐的mid
    - qlt: 音乐质量 (128, 320, flac)
    返回值:
    - filename: 下载的文件名
    - metadata_state: 元数据处理状态

    仅使用utils里面的方法下载音乐并处理元数据
    """

    mid = request.args.get("mid", type=str)
    quality = request.args.get("qlt", type=str, default="flac")

    if not mid:
        return jsonify(error="Missing 'mid' parameter"), 400

    try:
        qq_music = GetAudioResource(cookie, "")
        song_info = qq_music.get_song_info(mid)

        # Check if we got valid song info
        if not song_info or song_info.get("singer") == "Unknown":
            return jsonify(error="Failed to get song information"), 500

        singer = song_info["singer"]
        song_name = song_info["songname"]
        filename = f"{singer} - {song_name}.{'flac' if quality == 'flac' else 'mp3'}"

        audio_url = qq_music.audio_get(mid, quality)
        if not audio_url or audio_url == "Error":
            return jsonify(error="Failed to get audio URL"), 500

        download_file(audio_url, filename)

        lyrics = qq_music.audio_lyrics_get(mid)
        cover = qq_music.audio_cover_get(song_info["albummid"])

        meta = AudioProcessing(
            audio=filename, title=song_name, artist=singer, lyrics=lyrics, cover=cover
        )
        meta.metadata_processing()

        return jsonify(filename=filename, metadata_state="processed")

    except Exception as e:
        return jsonify(error=f"Download failed: {str(e)}"), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

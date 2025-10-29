import requests

from tqdm import tqdm
from get_audio_resource import GetAudioResource
from metadata_processing import AudioProcessing

with open("cookie.txt", "r") as f:
    cookie = f.read()

def auto_metadata_match(search, audio):
    music = GetAudioResource(cookie, search)
    music_list = music.audio_search()
    meta_check = AudioProcessing(audio=audio)
    title, artist, lyrics, cover = meta_check.metadata_check()
    song_id = music_list[0]['songmid']
    song_name = music_list[0]['songname'] if not title else None
    singer = music_list[0]['singer'][0]['name'] if not artist else None
    lyrics = music.audio_lyrics_get(song_id) if not lyrics else None
    cover_id = music_list[0]['albummid']
    cover = music.audio_cover_get(cover_id) if not cover else None
    return song_name, singer, lyrics, cover

def download_file(url: str, filename: str, chunk_size: int = 8192) -> None:
    """
    带进度条的文件下载
    :param url: 下载链接
    :param filename: 保存到本地的文件名
    :param chunk_size: 分块大小，默认 8 KB
    """
    with requests.get(url, stream=True) as r:
        r.raise_for_status()

        # 总长度（字节）
        total = int(r.headers.get('content-length', 0))
        # 创建进度条
        with tqdm(total=total, unit='B', unit_scale=True, desc=filename) as bar:
            with open(filename, 'wb') as f:
                for chunk in r.iter_content(chunk_size=chunk_size):
                    if chunk:
                        f.write(chunk)
                        bar.update(len(chunk))   # 更新进度

def get_audio_file(search, quality):
    music = GetAudioResource(cookie, search)
    music_list = music.audio_search()
    song_id = music_list[0]['songmid']
    singer = music_list[0]['singer'][0]['name']
    song_name = music_list[0]['songname']
    if quality == '128' and '320':
        filename = f'{singer} - {song_name}.mp3'
    elif quality == 'flac':
        filename = f'{singer} - {song_name}.flac'
    else:
        raise '暂无对应质量音频'
    getaudio = music.audio_get(song_id, quality)
    download_file(getaudio, filename)
    lyrics = music.audio_lyrics_get(song_id)
    cover_id = music_list[0]['albummid']
    cover = music.audio_cover_get(cover_id)
    metadata = AudioProcessing(filename, song_name, singer, lyrics, cover)
    return filename, metadata.metadata_processing()
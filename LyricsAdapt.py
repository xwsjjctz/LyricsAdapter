from metadata_processing import AudioProcessing
from decrypt import Decrypt
from get_audio_resource import GetAudioResource

import os

audio = 'Lemon-米津玄師.flac'

def auto_meta_match():
    with open("cookie.txt", "r") as f:
        cookie = f.read()
    search = os.path.splitext(audio)[0].replace('-', ' ')
    music = GetAudioResource(cookie, search)
    music_list = music.audio_search()
    album_name = music_list[0]['albumname']
    song_name = music_list[0]['songname']
    song_id = music_list[0]['songmid']
    cover_id = music_list[0]['albummid']
    song_mid = music_list[0]['songmid']
    singer = music_list[0]['singer'][0]['name']
    audio_lyrics = music.audio_lyrics_get(song_id)
    audio_cover = music.audio_cover_get(cover_id)
    return album_name, song_name, song_id, singer, song_mid, audio_lyrics, audio_cover


if __name__ == "__main__":
    album_name, title, song_id, artist, song_mid, lyrics, cover = auto_meta_match()
    meta = AudioProcessing(
        audio=audio,
        title=title, 
        artist=artist, 
        lyrics=lyrics, 
        cover=cover
        )
    meta.metadata_processing()

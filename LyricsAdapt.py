from metadata_processing import AudioProcessing
from decrypt import Decrypt
from get_audio_resource import GetAudioResource

import os

audio = '刘若英 - 后来 [mqms2].flac'

def auto_meta_match():
    with open("cookie.txt", "r") as f:
        cookie = f.read()
    search = os.path.splitext(audio)[0].replace('-', ' ')
    music = GetAudioResource(cookie, search)
    music_list = music.audio_search()

    meta_check = AudioProcessing(audio=audio)
    title, artist, lyrics, cover = meta_check.metadata_check()
    song_id = music_list[0]['songmid']
    song_name = music_list[0]['songname'] if not title else None
    singer = music_list[0]['singer'][0]['name'] if not artist else None
    audio_lyrics = music.audio_lyrics_get(song_id) if not lyrics else None
    cover_id = music_list[0]['albummid']
    audio_cover = music.audio_cover_get(cover_id) if not cover else None
    
    # album_name = music_list[0]['albumname']
    # song_mid = music_list[0]['songmid']
    
    return song_name, song_id, singer, audio_lyrics, audio_cover


if __name__ == "__main__":
    title, song_id, artist, lyrics, cover = auto_meta_match()
    meta = AudioProcessing(
        audio=audio,
        title=title, 
        artist=artist, 
        lyrics=lyrics, 
        cover=cover
        )
    meta.metadata_processing()

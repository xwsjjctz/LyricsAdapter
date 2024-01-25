from metadata_processing import AudioProcessing
from decrypt import Decrypt
from get_audio_resource import GetAudioResource

import os
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("audiopath", help="run the path of the audio file", type=str)
parser.add_argument("-d", "--delete", help="delete metadata from the audio file", action="store_true")
args = parser.parse_args()

meta_check = AudioProcessing(audio=args.audiopath)

def auto_meta_match():
    with open("cookie.txt", "r") as f:
        cookie = f.read()
    search = os.path.splitext(args.audiopath)[0].replace('-', ' ')
    music = GetAudioResource(cookie, search)
    music_list = music.audio_search()
    title, artist, lyrics, cover = meta_check.metadata_check()
    song_id = music_list[0]['songmid']
    song_name = music_list[0]['songname'] if not title else None
    singer = music_list[0]['singer'][0]['name'] if not artist else None
    audio_lyrics = music.audio_lyrics_get(song_id) if not lyrics else None
    cover_id = music_list[0]['albummid']
    audio_cover = music.audio_cover_get(cover_id) if not cover else None
    return song_name, singer, audio_lyrics, audio_cover


if __name__ == "__main__":
    title_status, artist_status, lyrics_status, cover_status = meta_check.metadata_check()
    title, artist, lyrics, cover = auto_meta_match()
    print(f'''
        Audio: {args.audiopath}
        Args: {"delete" if args.delete else "add"}
        Metadata Status Input: 
            artist: {artist_status}, 
            title: {title_status}, 
            lyrics: {lyrics_status}, 
            cover: {cover_status}
        Response Status: 
            artist: {bool(artist)}, 
            title: {bool(title)}, 
            lyrics: {bool(lyrics)}, 
            cover: {bool(cover)}
        Metadata Status Output: 
            artist: {artist_status | bool(artist) if not args.delete else False}, 
            title: {title_status | bool(title) if not args.delete else False}, 
            lyrics: {lyrics_status | bool(lyrics) if not args.delete else False}, 
            cover: {cover_status | bool(cover) if not args.delete else False}
        ''')
    meta = AudioProcessing(
        audio=args.audiopath,
        title=title, 
        artist=artist, 
        lyrics=lyrics, 
        cover=cover
        )
    meta.metadata_delete() if args.delete else meta.metadata_processing()
    

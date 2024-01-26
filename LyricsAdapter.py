from metadata_processing import AudioProcessing
from decrypt import Decrypt
from get_audio_resource import GetAudioResource

import os
import argparse
import time

parser = argparse.ArgumentParser()
parser.add_argument("audiopath", help="path of the audio file or directory", type=str)
parser.add_argument("-d", "--delete", help="delete metadata from the audio file", action="store_true")
args = parser.parse_args()

search = os.path.splitext(os.path.basename(args.audiopath))[0].replace('-', '')
with open("cookie.txt", "r") as f:
    cookie = f.read()

def get_all_audio(dir):
    lst = []
    for i in os.listdir(dir):
        lst.append(i) if os.path.splitext(i)[1] == ".mp3" or os.path.splitext(i)[1] == ".flac" else None
    return lst

def auto_meta_match(search_info, audio):
    music = GetAudioResource(cookie, search_info)
    music_list = music.audio_search()
    meta_check = AudioProcessing(audio=audio)
    title, artist, lyrics, cover = meta_check.metadata_check()
    song_id = music_list[0]['songmid']
    song_name = music_list[0]['songname'] if not title else None
    singer = music_list[0]['singer'][0]['name'] if not artist else None
    audio_lyrics = music.audio_lyrics_get(song_id) if not lyrics else None
    cover_id = music_list[0]['albummid']
    audio_cover = music.audio_cover_get(cover_id) if not cover else None
    return song_name, singer, audio_lyrics, audio_cover

if __name__ == "__main__":
    if os.path.isdir(args.audiopath):
        audio = get_all_audio(args.audiopath)
        with open("batch.log", "a") as f:
            f.truncate(0)
        for i in audio:
            audio_name = os.path.abspath('.') + args.audiopath + i
            batch_search = os.path.splitext(i)[0].replace('-', ' ')
            title, artist, lyrics, cover = auto_meta_match(batch_search, audio_name)
            meta = AudioProcessing(
                audio=audio_name, 
                title=title, 
                artist=artist, 
                lyrics=lyrics, 
                cover=cover
            )
            meta.metadata_delete() if args.delete else meta.metadata_processing()
            meta_check = AudioProcessing(audio=audio_name)
            title_status, artist_status, lyrics_status, cover_status = meta_check.metadata_check()
            info = f'''
    time: {time.strftime("%H:%M:%S", time.localtime())}
    Args: {"delete" if args.delete else "add"}
    Audio: "{audio_name}"
    Search: {batch_search}
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
            '''
            print(info)
            with open("batch.log", "a") as f:
                f.writelines(info)
            time.sleep(0.5)
    else:
        meta_check = AudioProcessing(audio=args.audiopath)
        title, artist, lyrics, cover = auto_meta_match(search, args.audiopath)
        title_status, artist_status, lyrics_status, cover_status = meta_check.metadata_check()
        meta = AudioProcessing(
            audio=args.audiopath,
            title=title, 
            artist=artist, 
            lyrics=lyrics, 
            cover=cover
            )
        meta.metadata_delete() if args.delete else meta.metadata_processing()
        info = f'''
    Args: {"delete" if args.delete else "add"}
    Audio: {args.audiopath}
    Search: {search}
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
        '''
        print(info)

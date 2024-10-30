from metadata_processing import AudioProcessing
from decrypt import Decrypt
from audio_resource import auto_metadata_match, get_audio_file

import os
import argparse
import time
import re

parser = argparse.ArgumentParser()
parser.add_argument("audio", help="path of the audiopath, directory or audio name", type=str)
parser.add_argument("-d", "--delete", help="delete metadata from the audio", action="store_true")
parser.add_argument("-l", "--lyrics", help="add lyrics", action="store_true")
parser.add_argument("-r", "--reserve", help="decrypt audio", action="store_true")
parser.add_argument("-q", "--quality", help="audio quality")
args = parser.parse_args()

search = os.path.splitext(os.path.basename(args.audio))[0].replace('-', '')
search = re.sub(r'\[.*?\]', '', search)

def get_all_audio(dir):
    lst = []
    for i in os.listdir(dir):
        lst.append(i) if os.path.splitext(i)[1] == ".mp3" or os.path.splitext(i)[1] == ".flac" else None
    return lst

def get_all_encrypt_audio(dir):
    if os.path.isdir(dir):
        lst = []
        for i in os.listdir(dir):
            lst.append(i) if os.path.splitext(i)[1] == ".mgg" or os.path.splitext(i)[1] == ".mflac" else None
        return lst
    else:
        if os.path.isfile(dir):
            return [dir]
        else:
            raise FileNotFoundError

def audio_decrypt(audio):
    if os.path.isdir(audio):
        get_audio = get_all_encrypt_audio(audio)
        print('''
        Decrypting...
            ''')
        for i in get_audio:
            if os.path.splitext(i)[1] == '.mflac':
                o_filename = os.path.splitext(i)[0] + '.flac'
            else: 
                o_filename = os.path.splitext(i)[0] + '.mp3'
            decrypt = Decrypt(audio + i, audio + o_filename)
            decrypt.qmc_decrypt()
            print(f'''
        Output: {audio + o_filename}
                ''')
        print('''
        Complete
            ''')
    else:
        get_audio = get_all_encrypt_audio(audio)
        if os.path.splitext(get_audio[0])[1] == '.mflac':
            o_filename = os.path.splitext(get_audio[0])[0] + '.flac'
        else: 
            o_filename = os.path.splitext(get_audio[0])[0] + '.mp3'
        print('''
        Decrypting...
            ''')
        decrypt = Decrypt(get_audio[0], o_filename)
        decrypt.qmc_decrypt()
        print(f'''
        Output: {o_filename}
            ''')
        print('''
        Complete
            ''')

if __name__ == "__main__":
    if os.path.isdir(args.audio):
        if args.reserve:
            audio_decrypt(args.audio)
        else:
            audio = get_all_audio(args.audio)
            with open("batch.log", "a", encoding='utf-8') as f:
                f.truncate(0)
            for i in audio:
                try:
                    audio_name = args.audio + i
                    batch_search = os.path.splitext(i)[0].replace('-', ' ')
                    filtered_search = re.sub(r'\[.*?\]', '', batch_search)
                    title, artist, lyrics, cover = auto_metadata_match(filtered_search, audio_name)
                    meta = AudioProcessing(
                        audio=audio_name, 
                        title=title, 
                        artist=artist, 
                        lyrics=lyrics, 
                        cover=cover
                    )
                    meta_check = AudioProcessing(audio=audio_name)
                    title_status, artist_status, lyrics_status, cover_status = meta_check.metadata_check()
                    meta.metadata_delete() if args.delete else meta.metadata_processing()
                    info = f'''
    time: {time.strftime("%H:%M:%S", time.localtime())}
    Args: {"delete" if args.delete else "add"}
    Audio: "{audio_name}"
    Search: {filtered_search}
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
                    with open("batch.log", "a", encoding='utf-8') as f:
                        f.writelines(info)
                except Exception as e:
                    pass
                continue
    else:
        if args.reserve:
            audio_decrypt(args.audio)
        elif os.path.isfile(args.audio):
            meta_check = AudioProcessing(audio=args.audio)
            title, artist, lyrics, cover = auto_metadata_match(search, args.audio)
            title_status, artist_status, lyrics_status, cover_status = meta_check.metadata_check()
            meta = AudioProcessing(
                audio=args.audio,
                title=title, 
                artist=artist, 
                lyrics=lyrics, 
                cover=cover
                )
            meta.metadata_delete() if args.delete else meta.metadata_processing()
            info = f'''
        Args: {"delete" if args.delete else "add"}
        Audio: {args.audio}
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
        else:
            filename, _ = get_audio_file(args.audio, args.quality)
            print(f'Download: {filename}')
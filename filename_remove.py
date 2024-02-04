import re
import argparse
import os
from LyricsAdapter import get_all_audio

parser = argparse.ArgumentParser()
parser.add_argument("audiopath", help="path of the audio file or directory", type=str)
parser.add_argument("-d", "--delete", help="delete metadata from the audio file", action="store_true")
args = parser.parse_args()
audio = get_all_audio(args.audiopath)

if __name__ == "__main__":
    for i in audio:
        if '[mqms]' in i:
            search = re.sub(r'\[.*?\]', '', i)
            search = os.path.splitext(search)[0][:-1] + os.path.splitext(search)[1]
            fn = args.audiopath + i
            fn_search = args.audiopath + search
            try:
                os.rename(fn, fn_search)
            except FileExistsError as e:
                os.remove(fn)
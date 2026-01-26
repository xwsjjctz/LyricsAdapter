import argparse
import os
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("audiopath", help="path of the audio file or directory", type=str)
parser.add_argument(
    "-d", "--delete", help="delete metadata from the audio file", action="store_true"
)
args = parser.parse_args()


def get_all_audio(dir):
    lst = []
    for i in os.listdir(dir):
        lst.append(i) if os.path.splitext(i)[1] == ".mp3" or ".flac" or ".wav" else None
    return lst


audio = get_all_audio(args.audiopath)

if __name__ == "__main__":
    for i in audio:
        # print(i)
        search = os.path.splitext(i)[0] + ".flac"
        # print(search)
        cmd = ["ffmpeg", "-i", args.audiopath + i, args.audiopath + f"{search}"]
        # print(cmd)
        subprocess.Popen(cmd)

import argparse
import os
import subprocess

class Decrypt():
    
    def __init__(self, audio, output):
        self.audio = audio
        self.output = output
        self.ext = self.__get_file_ext()

    def __get_file_ext(self):
        return os.path.splitext(self.audio)[-1]
    
    def qmc_decrypt(self):
        cmd = ['node', 'dist/index.js',
               '-i', self.audio, 
               '-e', self.ext, 
               '-o', self.output]
        return subprocess.Popen(cmd)
        
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("audiopath", help="path of the audio file or directory", type=str)
    parser.add_argument("-d", "--delete", help="delete metadata from the audio file", action="store_true")
    args = parser.parse_args()
    if os.path.splitext(args.audiopath)[1] == '.mflac':
        o_filename = os.path.splitext(args.audiopath)[0] + '.flac'
    else: 
        o_filename = os.path.splitext(args.audiopath)[0] + '.mp3'
    decrypt = Decrypt(args.audiopath, o_filename)
    decrypt.qmc_decrypt()
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
        
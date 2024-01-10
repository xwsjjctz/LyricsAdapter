# with open('resource/Aspyer _ Kyle Reynolds _ Carly Jay - Chance.flac', 'rb') as f:  
#     bytecode = f.readline()  
#     print(bytecode)
# with open('bytecode.txt', 'wb') as f:  
#     f.write(bytecode)

import subprocess  
  
def get_ffprobe_output_line(audio_file):  
    cmd = ['ffprobe', '-i', audio_file, '-hide_banner']  
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)  
    output, _ = process.communicate()  
    return output  
  
# 使用示例  
audio_file = 'resource\\azi_阿楚姑娘.mp3'  # 请替换为你的音频文件路径  
line = get_ffprobe_output_line(audio_file)  
print(line)
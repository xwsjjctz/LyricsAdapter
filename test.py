import mutagen

filename = 'azi_阿楚姑娘.mp3'
print('File:', filename)
audio = mutagen.File(filename)
print(audio)
# print(audio.tags["TALB"].text[0])
# print(audio.tags["TPE2"].text[0])
# print(audio.tags["TIT2"].text[0])
# print(audio.tags["TCON"].text[0])
# print(audio.tags["TPE1"].text[0])
# print(audio.tags["TDRC"].text[0])

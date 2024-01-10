from audio_processing import AudioProcessing

with open("Mine - Phoebe Ryan.lrc", 'r') as f:
    lrc = f.read()
    music = AudioProcessing("『 叹 』又土又仙又涩，国风越南神曲翻唱_兰音.flac", 
                            "叹", 
                            "兰音Reine", 
                            lrc, 
                            "兰音Reine.jpeg")
    music.metadata_processing()
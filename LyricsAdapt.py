from metadata_processing import AudioProcessing
from decrypt import Decrypt

decrypt = Decrypt(
    audio="兰音Reine - 等不来花开.mflac", 
    output="兰音Reine - 等不来花开.flac"
    )
decrypt.audio_decrypt()

music = AudioProcessing(
    audio="24kGoldn&iann dior - Mood (Explicit).mp3",
    title="叹", 
    artist="兰音Reine", 
    lyrics=None, 
    cover="1.jpeg"
    )
music.metadata_processing()
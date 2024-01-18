import { DecryptQmcWasm } from '@/qmc_wasm';
import * as fs from 'fs';

async function readFileAsArrayBuffer(filePath: string): Promise<ArrayBuffer> {
    const buffer = await fs.promises.readFile(filePath);
    // 将Node.js的Buffer转换为ArrayBuffer
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function main() {
    const musicBlob: ArrayBuffer = await readFileAsArrayBuffer("阿桑 - 一直很安静.mflac");
    // 在这里使用 musicBlob
    const ext = "flac";
    const decrypted = (await DecryptQmcWasm(musicBlob, ext)).data;
    const musicFile = fs.writeFile("decrypted.flac", decrypted, (err) => {
        if (err) {
            console.error("Error in writeFile:", err);
        }
    });
}

main().catch((error) => {
    console.error("Error in main:", error);
});
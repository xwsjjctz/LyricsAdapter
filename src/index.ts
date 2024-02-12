import { DecryptQmcWasm } from './qmc_wasm.js';
import * as fs from 'fs';
import * as command from 'commander';

async function readFileAsArrayBuffer(filePath: string): Promise<ArrayBuffer> {
    const buffer = await fs.promises.readFile(filePath);
    // 将Node.js的Buffer转换为ArrayBuffer
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function main() {
    const program = new command.Command();
    program
        .usage('[options] <file ...>')
        .option('-i, --input <type>', 'file path', "dylanf - Canon in D Major (卡农钢琴曲_经典钢琴版).mflac")
        .option('-e, --ext <type>', 'music ext', "mflac")
        .option('-o, --output <type>', 'file path', "dylanf - Canon in D Major (卡农钢琴曲_经典钢琴版).flac");
    program.parse(process.argv);
    const options = program.opts();
    // console.log(options.input);
    // console.log(options.output);
    // console.log(options.ext);
    const musicBlob: ArrayBuffer = await readFileAsArrayBuffer(options.input);
    // 在这里使用 musicBlob
    const ext = options.ext;
    const decrypted = (await DecryptQmcWasm(musicBlob, ext)).data;
    const musicFile = fs.writeFile(options.output, decrypted, (err) => {
        if (err) {
            console.error("Error in writeFile:", err);
        }
    });
} main().catch((error) => {
    console.error("Error in main:", error);
});
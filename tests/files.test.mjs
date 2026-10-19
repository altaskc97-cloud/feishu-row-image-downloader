import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {safeName,uniqueName} from '../src/files.mjs';
test('safe paths and Windows reserved names',()=>{assert.equal(safeName('../a\\b.png'),'.._a_b.png');assert.equal(safeName('CON.png'),'_CON.png');assert.equal(safeName('a. '),'a');});
test('case insensitive collisions preserve all files',()=>{const used=new Set();assert.equal(uniqueName('图.png',used),'图.png');assert.equal(uniqueName('图.png',used),'图 (2).png');assert.equal(uniqueName('图 (2).png',used),'图 (2) (2).png');});
test('ZIP round trip preserves bytes and duplicate attachments',async()=>{const zip=new JSZip(),used=new Set(),bytes=new Uint8Array([0,255,23,128]);zip.file(uniqueName('a.png',used),bytes);zip.file(uniqueName('a.png',used),bytes);const loaded=await JSZip.loadAsync(await zip.generateAsync({type:'uint8array'}));assert.deepEqual(await loaded.file('a (2).png').async('uint8array'),bytes);assert.equal(Object.keys(loaded.files).length,2);});

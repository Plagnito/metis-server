"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"), path=require("node:path"),crypto=require("node:crypto");
// Fingerprints of the owner's original Atlas revision 227e897. Changing the
// instance adapters must not silently redesign the agreed interface.
test("Original Métis base styles and repository interactions remain stable",()=>{
  const root=path.join(__dirname,'../src/native/web');
  for(const [file,expected] of [['metis-pages.cjs','1fab3ec5ef146be4b7493493b18aaa05a6a17fd8f95e8d7dfbe1f940db96e687'],['metis-securite-page.cjs','2989df3e4e4372b7d060b1820ae9ffc213e5daca8e268674066f51daa3fac60b']]) {
    const source=fs.readFileSync(path.join(root,file),'utf8');
    const css=new RegExp('const CSS = '+String.fromCharCode(96)+'([\\s\\S]*?)'+String.fromCharCode(96)+';').exec(source)[1];
    assert.equal(crypto.createHash('sha256').update(css).digest('hex'),expected,file);
  }
  // The only browser interaction extension is the explicit limited-analysis label.
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'public/metis-securite.js'))).digest('hex'),'f0b70f5db2cd0ad9ae8f89188a1e3686d7efbfecc7970bd1a3bccd19ca12e648');
});

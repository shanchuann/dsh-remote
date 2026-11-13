import { Lexer, type Token, type Tokens } from 'marked';
export type MarkdownInline = { text: string; bold?: boolean; italic?: boolean; code?: boolean; strike?: boolean; href?: string; image?: string };
export type MarkdownListItem = { text: string; checked?: boolean; children?: MarkdownBlock[] };
export type MarkdownBlock =
 | { type: 'paragraph'; text: string }
 | { type: 'heading'; level: number; text: string }
 | { type: 'list'; ordered: boolean; start?: number; items: MarkdownListItem[] }
 | { type: 'quote'; text: string }
 | { type: 'table'; headers: string[]; rows: string[][] }
 | { type: 'code'; text: string; language?: string }
 | { type: 'hr' };
const entities: Record<string,string> = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
/** Cheap equality for common prose; structured tables/lists also compare their cells. */
export function sameMarkdownBlock(a: MarkdownBlock, b: MarkdownBlock): boolean {
 if (a === b) return true;
 if (a.type !== b.type) return false;
 if (a.type === 'hr') return true;
 if (a.type === 'paragraph' || a.type === 'quote') return a.text === (b as typeof a).text;
 if (a.type === 'heading') return a.text === (b as typeof a).text && a.level === (b as typeof a).level;
 if (a.type === 'code') return a.text === (b as typeof a).text && a.language === (b as typeof a).language;
 return JSON.stringify(a) === JSON.stringify(b);
}
function decode(text:string):string { return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw,key:string)=> {if(!key.startsWith('#')) return entities[key.toLowerCase()] ?? raw; const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1)); return n>0&&n<=0x10ffff?String.fromCodePoint(n):raw;}); }
export function parseInlineMarkdown(text:string):MarkdownInline[] {
 const out:MarkdownInline[]=[];
 function walk(tokens:Token[],flags:Partial<MarkdownInline>={}) { for(const t of tokens) {
  if(t.type==='strong'||t.type==='em'||t.type==='del') walk(t.tokens ?? [],{...flags,...(t.type==='strong'?{bold:true}:t.type==='em'?{italic:true}:{strike:true})});
  else if(t.type==='link') walk(t.tokens ?? [],{...flags,href:t.href});
  else if(t.type==='image') out.push({...flags,text:decode(t.text),image:t.href});
  else if(t.type==='codespan') out.push({...flags,text:t.text,code:true});
  else if(t.type==='br') out.push({...flags,text:'\n'});
  else if('tokens' in t && t.tokens) walk(t.tokens as Token[],flags);
  else out.push({...flags,text:decode('text' in t?String(t.text):t.raw)});
 }}
 walk(Lexer.lexInline(text,{gfm:true,breaks:false})); return out;
}
export function tableCells(line:string):string[] {return line.trim().replace(/^[|｜]|[|｜]$/g,'').split(/(?<!\\)[|｜]/).map(x=>x.trim().replace(/\\\|/g,'|'));}
export function parseMarkdownBlocks(text:string):MarkdownBlock[] {
 const normalized=text.replace(/\r\n/g,'\n').split('\n').map(l=>l.includes('｜')?l.replaceAll('｜','|'):l).join('\n');
 const blocks:MarkdownBlock[]=[];
 for(const t of Lexer.lex(normalized,{gfm:true,breaks:false})) {
  if(t.type==='space') continue;
  if(t.type==='heading') blocks.push({type:'heading',level:t.depth,text:t.text});
  else if(t.type==='hr') blocks.push({type:'hr'});
  else if(t.type==='code') blocks.push({type:'code',text:t.text,language:t.lang});
  else if(t.type==='blockquote') blocks.push({type:'quote',text:t.text});
  else if(t.type==='table') blocks.push({type:'table',headers:(t as Tokens.Table).header.map(c=>c.text),rows:(t as Tokens.Table).rows.map(r=>r.map(c=>c.text))});
  else if(t.type==='list') blocks.push({type:'list',ordered:t.ordered,...(t.ordered?{start:Number(t.start)||1}:{}),items:(t as Tokens.List).items.map(item=>({text:item.text,...(item.task?{checked:item.checked}:{}),...(item.tokens.some(n=>n.type==='list')?{children:parseMarkdownBlocks(item.text)}:{})}))});
  else if('text' in t) blocks.push({type:'paragraph',text:String(t.text)});
 }
 return blocks;
}

const g=require("./LlmService"),m=require("./ContextStore"),c=6e4,l=`You extract a structured candidate profile from r\xE9sum\xE9s and career documents.

Return ONLY a JSON object. No prose, no markdown fences, no commentary.

Schema:
{
  "name": string,
  "headline": string,
  "location": string,
  "yearsExperience": number|null,
  "skills": [{ "name": string, "level": string, "years": number|null }],
  "experience": [{ "company": string, "title": string, "start": string, "end": string,
                   "bullets": [string], "metrics": [string] }],
  "projects": [{ "name": string, "summary": string, "stack": [string], "impact": string }],
  "education": [{ "school": string, "degree": string, "field": string, "start": string, "end": string }],
  "stories": [{ "title": string, "situation": string, "task": string, "action": string,
                "result": string, "tags": [string] }]
}

Rules:
- Use only facts present in the source text. Never invent employers, dates, metrics or results.
- Leave a field empty rather than guessing.
- "metrics" holds quantified outcomes exactly as written (e.g. "cut p99 latency 40%").
- "stories" is a STAR bank built from the strongest achievements. Write 4-8 where the source
  supports them, each one specific enough to answer a behavioural question. Tag each story with
  lowercase themes such as "leadership", "conflict", "failure", "scaling", "ownership", "debugging".
- Dates stay in the source's format.`;class d{parseJson(n){if(!n||typeof n!="string")return null;let e=n.trim();const t=e.match(/```(?:json)?\s*([\s\S]*?)```/i);t&&(e=t[1].trim());const r=e.indexOf("{"),i=e.lastIndexOf("}");if(r===-1||i===-1||i<=r)return null;const s=e.slice(r,i+1);try{return JSON.parse(s)}catch{try{return JSON.parse(s.replace(/,\s*([}\]])/g,"$1"))}catch{return null}}}async distill(n,e){const t=(n||"").trim();if(!t)throw new Error("Add a r\xE9sum\xE9 or profile document first.");const r=t.length>c,i=r?t.slice(0,c):t;r&&console.warn(`[ProfileBuilder] Source text truncated to ${c} characters for distillation.`),e&&e("Reading documents");let s="";await g.stream({system:l,messages:[{role:"user",content:`Source documents:

${i}`}],priority:"user"},u=>{s+=u,e&&s.length%400<12&&e("Building profile")}),e&&e("Parsing profile");const o=this.parseJson(s);if(!o)throw new Error("The model did not return usable JSON. Try a stronger model and run it again.");const a=m.normaliseProfile(o);if(!a.name&&!a.experience.length&&!a.skills.length)throw new Error("Nothing usable came back. Check that the document contains readable text.");return a}}module.exports=new d,module.exports.SYSTEM_PROMPT=l;

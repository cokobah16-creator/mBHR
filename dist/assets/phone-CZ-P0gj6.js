function t(t){if(!t)return null;let r=String(t).replace(/\D+/g,"");return r?(r.startsWith("0")?r="234"+r.slice(1):r.startsWith("234")||(r="234"+r),"+"+r):null}export{t as n};

// Software License Agreement (ISC License)
//
// Copyright (c) 2017, Matthew Voss
//
// Permission to use, copy, modify, and/or distribute this software for
// any purpose with or without fee is hereby granted, provided that the
// above copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

var qbsrc = require('qb-src')
var next = require('qb-json-next')
var POS = next.POS
var TOK = next.TOK
var ECODE = next.ECODE

function err (msg) { throw Error(msg) }

// convert position into public ascii code (with accurate position state instead of obj/arr context)
// F - before first value or first key-value
// J - before key, K - within key, L - after key
// U - before val, V - within val, W - after val
function pos2char (pos, ecode) {
  if (ecode === ECODE.TRUNCATED || ecode === ECODE.TRUNC_DEC) {
    switch (pos) {
      case POS.O_BF: case POS.O_BK: return 'K'
      case POS.A_BF: case POS.A_BV: case POS.O_BV: return 'V'
      default: err('position not compatible with truncated or bad value: ' + pos.toString(16))
    }
  }
  switch (pos) {
    case POS.A_BF: case POS.O_BF: return 'F'
    case POS.O_BK: return 'J'
    case POS.O_AK: return 'L'
    case POS.A_BV: case POS.O_BV: return 'U'
    case POS.A_AV: case POS.O_AV: return 'W'
  }
}

// convert public ascii code back to position
function char2pos (char, stack) {
  if (char == null) {
    return POS.A_BF
  }
  if (stack[stack.length - 1] === 123) {
    switch (char) {
      case 'F': return POS.O_BF
      case 'J': case 'K': return POS.O_BK
      case 'L': return POS.O_AK
      case 'U': case 'V': return POS.O_BV
      case 'W': return POS.O_AV
      default: err('cannot restore object position "' + char + '"')
    }
  } else {
    switch (char) {
      case 'F': return POS.A_BF
      case 'U': case 'V': return POS.A_BV
      case 'W': return POS.A_AV
      default: err('cannot restore array position "' + char + '"')
    }
  }
}

function encode (ps) {
  var ret = ps.vlim + '/' +  ps.vcount + '/'
  ret += ps.stack.map(function (b) { return String.fromCharCode(b) }).join('')
  var pcode = pos2char(ps.pos, ps.ecode)
  ret += pcode

  var klen = ps.klim - ps.koff
  var vlen = ps.vlim - ps.voff
  if (klen) {
    ret += klen
    var gap = ps.voff - ps.klim
    if (gap !== (pcode < 'U' ? 0 : 1)) {
      ret += '.' + gap      // report key/value gaps other than no-space expected gaps
    }
    if (vlen) {
      ret += ':' + vlen
    }
  } else if (vlen) {
    ret += vlen
  }

  if (ps.ecode === ECODE.BAD_VALUE || ps.ecode === ECODE.UNEXPECTED) {
    ret += '!' + String.fromCharCode(ps.ecode)
  }
  return ret
}

function map_ascii (s, code) {
  return s.split('').reduce(function (m,c) { m[c] = code; return m }, {})
}

//                    stack     pos_char  kvlen       .gap        : vlen         token-error-code
var PARSE_POS_RE = /^([{\[]+)?([FJKLUVW])(?:(?:(\d+)(?:\.(\d+))?)(?::(\d))?)?(?:!([BTU]))?$/

function decode (s) {
  var parts = s.split('/')
  var vlim = parseInt(parts[0])
  var vcount = parseInt(parts[1])
  var m = parts[2] && parts[2].match(PARSE_POS_RE) || err('could not decode: ' + s)

  var stack = m[1] && m[1].split('').map(function (b) { return b.charCodeAt(0) }) || []
  var pcode = m[2]
  var pos = char2pos(pcode, stack)
  var kvlen = m[3] && parseInt(m[3]) || 0
  var gap = m[4] ? parseInt(m[4]) : (pcode < 'U' ? 0 : 1)
  var vlen = m[5] && parseInt(m[5]) || 0
  var ecode = m[6] && m[6].charCodeAt(0) || ((pcode === 'K' || pcode === 'V') ? ECODE.TRUNCATED : 0)

  var ps = {
    src: null,
    next_src: null,
    lim: vlim,
    vcount: vcount,
    koff: 0,
    klim: 0,
    tok: 0,     // todo: encode or restore from src
    voff: 0,
    vlim: vlim,
    stack: stack,
    pos: pos,
    ecode: ecode,
  }
  if (in_obj(ps.stack)) {
    ps.voff = vlim - vlen
    ps.klim = ps.voff - gap
    if (kvlen) {
      ps.koff = ps.klim - kvlen
    } else {
      ps.koff = ps.klim = 0
    }
  } else {
    // in array or root
    ps.voff = vlim - kvlen
  }
  return ps
}

function in_obj (stack) {
  return stack[stack.length - 1] === 123
}

// just handles required cases from explain()
function pos_str (ps) {
  if (ps.ecode === ECODE.TRUNCATED) {
    switch (ps.pos) {
      case POS.O_BF: case POS.O_BK: return 'in key'
      case POS.O_BV: return 'in object value'
      case POS.A_BV: case POS.A_BF: return 'in value'
      default: err('ambiguous position')
    }
  } else {
    switch (ps.pos) {
      case POS.O_BF: return 'before first key'
      case POS.O_BK: return 'before key'
      case POS.O_AK: return 'after key'
      case POS.O_BV: return 'before object value'
      case POS.A_BV: return 'before value'
      case POS.O_AV: return 'after object value'
      case POS.A_AV: return 'after value'
      case POS.A_BF: return 'before first value'
      default: err('unknown position ' + ps.pos)
    }
  }
}

// explain ps as a human-readable string (error state, relative position and offset location(s))
function explain (ps) {
  var off = ps.voff
  var lim = ps.vlim
  var ret
  switch (ps.ecode) {
    case ECODE.UNEXPECTED:
      ret = 'unexpected value'
      break
    case ECODE.BAD_VALUE:
      ret = 'bad value'
      break
    case ECODE.TRUNC_DEC:
      switch (ps.pos) {
        case POS.O_BV:
          ret = 'truncated object decimal'
          break
        case POS.A_BF: case POS.A_BV:
          ret = 'truncated decimal'
      }
      break
    case ECODE.TRUNCATED:
      switch (ps.pos) {
        case POS.O_BF: case POS.O_BK:
          ret = 'truncated key'
          off = ps.koff
          lim = ps.klim
          break
        case POS.O_BV:
          ret = 'truncated object value'
          break
        case POS.A_BF: case POS.A_BV:
          ret = 'truncated value'
          break
        default:
          err('ambiguous position')
      }
      break
    case 0:
      ret = (ps.vlim < ps.lim ? '' : 'at limit ') + pos_str(ps)
      break
    default:
      err('unknown ecode: ' + ps.ecode)
  }
  return ret + ', ' + qbsrc.context_str(ps.src, off, lim, 5, 5, 20)
}

// convert human-readable object into ps object
function obj2ps (obj) {
  var stack = obj.stack != null && obj.stack.split('').map(function (c) { return c.charCodeAt(0) }) || []
  return {
    src: obj.src && obj.src.split('').map(function (c) {return c.charCodeAt(0)}) || null,
    next_src: obj.next_src && obj.next_src.split('').map(function (c) {return c.charCodeAt(0)}) || null,
    lim: obj.lim,
    vcount: obj.vcount,
    koff: obj.koff,
    klim: obj.klim,
    tok: obj.tok && obj.tok.charCodeAt(0) || 0,
    voff: obj.voff,
    vlim: obj.vlim,
    stack: obj.stack && obj.stack.split('').map(function (c) { return c.charCodeAt(0) }) || [],
    pos: char2pos(obj.pos, stack),
    ecode: obj.ecode && obj.ecode.charCodeAt(0) || 0,
  }
}

// convert ps into a more human-readable object
function ps2obj (ps) {
  return {
    src: ps.src && ps.src.map(function (c) { return String.fromCharCode(c) }).join(''),
    next_src: ps.next_src && ps.next_src.map(function (c) { return String.fromCharCode(c) }).join(''),
    vcount: ps.vcount,
    koff: ps.koff,
    klim: ps.klim,
    tok: ps.tok && String.fromCharCode(ps.tok) || '',
    voff: ps.voff,
    vlim: ps.vlim,
    stack: ps.stack.map(function (c) { return String.fromCharCode(c) }).join(''),
    pos: pos2char(ps.pos, ps.ecode),
    ecode: String.fromCharCode(ps.ecode),
  }
}

module.exports = {
  encode: encode,
  decode: decode,
  ps2obj: ps2obj,
  obj2ps: obj2ps,
  explain: explain,
  char2pos: char2pos,
  pos2char: pos2char,
  TOK: TOK,
  ECODE: ECODE,
  POS: POS,
}

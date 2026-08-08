import React, { useRef, useEffect, useCallback } from 'react';

/**
 * Lightweight WYSIWYG editor (font size, bold/italic/underline, clear
 * formatting, strikethrough, inline image) built on contentEditable +
 * document.execCommand — no external editor dependency for what's really a
 * handful of formatting commands.
 *
 * Pasted/inserted HTML is run through sanitizeHtml() (tag/attribute
 * allowlist, no event-handler attributes, image src restricted to
 * data:image/* or http(s)://) before it ever reaches the live DOM or
 * onChange, since a task's description is visible to whoever it's assigned
 * to — an unsanitized value would let one user plant markup that runs when
 * a different user later opens the task to edit it.
 *
 * Props: value (HTML string), onChange(html), placeholder, minHeight
 */

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'DIV', 'BR', 'P', 'IMG']);
const ALLOWED_ATTRS = { IMG: ['src'], SPAN: ['style'], DIV: ['style'], P: ['style'] };
const ALLOWED_STYLE_PROPS = /^(font-size|font-weight|font-style|text-decoration)\s*:/;

export const sanitizeHtml = (html) => {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');

  const clean = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!ALLOWED_TAGS.has(child.tagName)) {
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          clean(node);
          return;
        }
        const allowedAttrs = ALLOWED_ATTRS[child.tagName] || [];
        [...child.attributes].forEach((attr) => {
          if (!allowedAttrs.includes(attr.name.toLowerCase())) child.removeAttribute(attr.name);
        });
        if (child.tagName === 'IMG') {
          const src = child.getAttribute('src') || '';
          if (!/^data:image\//.test(src) && !/^https?:\/\//.test(src)) child.remove();
        }
        if (child.hasAttribute('style')) {
          const safeRules = child.getAttribute('style').split(';')
            .map(r => r.trim()).filter(r => ALLOWED_STYLE_PROPS.test(r));
          if (safeRules.length) child.setAttribute('style', safeRules.join(';'));
          else child.removeAttribute('style');
        }
        clean(child);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        node.removeChild(child);
      }
    });
  };
  clean(doc.body);
  return doc.body.innerHTML;
};

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24];

const ToolButton = ({ onClick, title, children, active }) => (
  <button type="button" title={title} onMouseDown={e => e.preventDefault()} onClick={onClick}
    style={{
      width: 26, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: '1px solid transparent', borderRadius: 4, background: active ? '#e0e7f0' : 'transparent',
      color: '#374151', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
    }}
    onMouseEnter={e => { e.currentTarget.style.background = '#e4e4e4'; }}
    onMouseLeave={e => { e.currentTarget.style.background = active ? '#e0e7f0' : 'transparent'; }}>
    {children}
  </button>
);

const RichTextEditor = ({ value = '', onChange, placeholder = 'Optional details...', minHeight = 110 }) => {
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastValue = useRef(value);

  useEffect(() => {
    if (editorRef.current && value !== lastValue.current && document.activeElement !== editorRef.current) {
      editorRef.current.innerHTML = sanitizeHtml(value);
      lastValue.current = value;
    }
  }, [value]);

  const emitChange = useCallback(() => {
    if (!editorRef.current) return;
    const html = sanitizeHtml(editorRef.current.innerHTML);
    if (editorRef.current.innerHTML !== html) editorRef.current.innerHTML = html;
    lastValue.current = html;
    onChange?.(html);
  }, [onChange]);

  const exec = (cmd, arg = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    emitChange();
  };

  const applyFontSize = (px) => {
    editorRef.current?.focus();
    document.execCommand('fontSize', false, '7');
    editorRef.current?.querySelectorAll('font[size="7"]').forEach((f) => {
      f.removeAttribute('size');
      f.style.fontSize = `${px}px`;
    });
    emitChange();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertHTML', false, html ? sanitizeHtml(html) : text.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
    emitChange();
  };

  const handleImagePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => exec('insertImage', reader.result);
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ border: '1px solid #d1d5db', borderRadius: 7, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '5px 6px', background: '#efefef', borderBottom: '1px solid #dedede' }}>
        <select defaultValue={12} onMouseDown={e => e.stopPropagation()} onChange={e => applyFontSize(Number(e.target.value))}
          style={{ height: 24, border: '1px solid #dedede', borderRadius: 4, fontSize: 11.5, color: '#374151', background: '#fff', marginRight: 4 }}>
          {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <ToolButton title="Bold" onClick={() => exec('bold')}><span style={{ fontWeight: 800 }}>B</span></ToolButton>
        <ToolButton title="Italic" onClick={() => exec('italic')}><span style={{ fontStyle: 'italic' }}>I</span></ToolButton>
        <ToolButton title="Underline" onClick={() => exec('underline')}><span style={{ textDecoration: 'underline' }}>U</span></ToolButton>
        <ToolButton title="Clear formatting" onClick={() => exec('removeFormat')}>⌫</ToolButton>
        <ToolButton title="Strikethrough" onClick={() => exec('strikeThrough')}><span style={{ textDecoration: 'line-through' }}>S</span></ToolButton>
        <ToolButton title="Insert image" onClick={() => fileInputRef.current?.click()}>🖼</ToolButton>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImagePick} style={{ display: 'none' }} />
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
        onBlur={emitChange}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        className="rte-body"
        style={{ minHeight, maxHeight: 260, overflowY: 'auto', padding: '8px 10px', fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1f2937' }}
      />
    </div>
  );
};

export default RichTextEditor;

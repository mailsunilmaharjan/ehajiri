import React from 'react';

/**
 * Standard Save button — underlines the "S" mnemonic and shows a Ctrl+S hint.
 * Pair with useSaveShortcut(active, onClick) so Ctrl+S triggers the same action.
 * Only underlines the first letter when the label actually starts with "S"
 * (skips the underline for translated labels that don't).
 */
const SaveButton = ({ onClick, label = 'Save', icon = '💾', className = 'btn btn-primary', disabled, style }) => {
  const startsWithS = label.charAt(0).toLowerCase() === 's';
  return (
    <button className={className} onClick={onClick} disabled={disabled} title="Ctrl+S" style={style}>
      {icon} {startsWithS ? <><u>{label[0]}</u>{label.slice(1)}</> : label}
      {' '}<span style={{ opacity:.7, fontSize:11, fontWeight:400 }}>(Ctrl+S)</span>
    </button>
  );
};

export default SaveButton;

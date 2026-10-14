/**
 * Shows a project's taxonomy mapping: every latin row and the label it maps to.
 */
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/Dialog';
import type { TaxonomyMappingEntry } from '../../api/types';

interface TaxonomyMappingDialogProps {
  open: boolean;
  onClose: () => void;
  entries: TaxonomyMappingEntry[];
}

export const TaxonomyMappingDialog: React.FC<TaxonomyMappingDialogProps> = ({ open, onClose, entries }) => (
  <Dialog open={open && entries.length > 0} onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent className="max-w-lg max-h-[80vh] flex flex-col" onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Species labels ({entries.length} rows)</DialogTitle>
      </DialogHeader>
      <div>
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-4 py-2">Latin</th>
              <th className="text-left px-4 py-2">Label</th>
            </tr>
          </thead>
        </table>
      </div>
      <div className="overflow-y-auto">
        <table className="w-full text-sm">
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t">
                <td className="px-4 py-2 font-mono text-xs">{entry.latin}</td>
                <td className="px-4 py-2">{entry.common}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DialogContent>
  </Dialog>
);

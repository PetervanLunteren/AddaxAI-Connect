/**
 * Modal for managing merged sites (shared independence interval pools).
 *
 * Sites in one group are treated as a single place for the independence
 * interval, for merging distinct sites like both ends of a wildlife crossing.
 * Operates on local state only, changes are committed by the parent component
 * when the user clicks "Save changes" on the settings page.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/Dialog';
import { Button } from './ui/Button';
import { MultiSelect, Option } from './ui/MultiSelect';
import type { SiteGroup } from '../api/types';
import type { SiteListItem } from '../api/sites';

interface Props {
  groups: SiteGroup[];
  sites: SiteListItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGroupsChange: (groups: SiteGroup[]) => void;
}

let nextTempId = -1;

export const SiteGroupsModal: React.FC<Props> = ({ groups, sites, open, onOpenChange, onGroupsChange }) => {
  // State
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingSiteIds, setEditingSiteIds] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);

  // Reset edit state when modal closes
  useEffect(() => {
    if (!open) {
      setEditingGroupId(null);
      setCreating(false);
      setNewGroupName('');
    }
  }, [open]);

  // All site IDs assigned to any group
  const assignedSiteIds = new Set(groups.flatMap(g => g.site_ids));
  const ungroupedSites = sites.filter(s => !assignedSiteIds.has(s.id));

  // Site IDs available when editing a specific group (ungrouped + already in this group)
  const availableSitesForEdit = (groupId: number) => {
    const group = groups.find(g => g.id === groupId);
    const groupSiteIds = new Set(group?.site_ids ?? []);
    return sites.filter(s => !assignedSiteIds.has(s.id) || groupSiteIds.has(s.id));
  };

  const startEditing = (group: SiteGroup) => {
    setEditingGroupId(group.id);
    setEditingName(group.name);
    setEditingSiteIds([...group.site_ids]);
  };

  const saveEditing = () => {
    if (editingGroupId === null) return;
    onGroupsChange(
      groups.map(g =>
        g.id === editingGroupId
          ? { ...g, name: editingName.trim(), site_ids: editingSiteIds }
          : g
      )
    );
    setEditingGroupId(null);
  };

  // Convert available sites to MultiSelect options for the editing group
  const siteOptionsForEdit = useMemo(() => {
    if (editingGroupId === null) return [];
    return availableSitesForEdit(editingGroupId).map(s => ({ label: s.name, value: s.id }));
  }, [editingGroupId, sites, groups]);

  const selectedSiteOptions = useMemo(() => {
    return siteOptionsForEdit.filter(opt => editingSiteIds.includes(opt.value as number));
  }, [siteOptionsForEdit, editingSiteIds]);

  const handleCreate = () => {
    const name = newGroupName.trim();
    if (!name) return;
    const tempId = nextTempId--;
    const newGroup: SiteGroup = {
      id: tempId,
      name,
      site_ids: [],
      created_at: new Date().toISOString(),
    };
    onGroupsChange([...groups, newGroup]);
    setNewGroupName('');
    setCreating(false);
  };

  const handleDelete = (groupId: number) => {
    onGroupsChange(groups.filter(g => g.id !== groupId));
    if (editingGroupId === groupId) setEditingGroupId(null);
  };

  const siteName = (id: number) => sites.find(s => s.id === id)?.name ?? `Site ${id}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Merged sites</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Sites in a group are treated as one place for the independence interval.
          </p>
        </DialogHeader>

        <div className="space-y-3">
          {/* Existing groups */}
          {groups.map(group => (
            <div key={group.id} className="border rounded-lg p-3">
              {editingGroupId === group.id ? (
                /* Editing mode */
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={saveEditing}
                      disabled={!editingName.trim()}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingGroupId(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Site multi-select */}
                  <MultiSelect
                    options={siteOptionsForEdit}
                    value={selectedSiteOptions}
                    onChange={(selected: Option[]) => setEditingSiteIds(selected.map(s => s.value as number))}
                    placeholder="Select sites..."
                  />
                </div>
              ) : (
                /* Display mode */
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{group.name}</p>
                    {group.site_ids.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {group.site_ids.map(id => (
                          <span key={id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                            {siteName(id)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">No sites assigned</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => startEditing(group)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(group.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* New group input */}
          {creating ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
                placeholder="Group name"
                className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!newGroupName.trim()}
              >
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setCreating(false); setNewGroupName(''); }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreating(true)}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              New group
            </Button>
          )}

          {/* Ungrouped sites */}
          {ungroupedSites.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Ungrouped sites ({ungroupedSites.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {ungroupedSites.map(site => (
                  <span key={site.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted/50 text-muted-foreground">
                    {site.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

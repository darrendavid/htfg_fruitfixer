import { useState } from 'react';
import { TriageTab } from '@/components/matches/TriageTab';
import { VarietyMatchTab } from '@/components/matches/VarietyMatchTab';
import { LostImageTab } from '@/components/matches/LostImageTab';
import { DedupReviewTab } from '@/components/matches/DedupReviewTab';
import { AttachmentOcrTab } from '@/components/matches/AttachmentOcrTab';
import { UnmatchedTab } from '@/components/matches/UnmatchedTab';
import { UnassignedTab } from '@/components/matches/UnassignedTab';
import { HiddenTab } from '@/components/matches/HiddenTab';
import { DocumentsTab } from '@/components/matches/DocumentsTab';
import { SwapCandidatesTab } from '@/components/matches/SwapCandidatesTab';
import { BottomNav } from '@/components/layout/BottomNav';

type ClassifyTab = 'triage' | 'varieties' | 'unmatched' | 'unassigned' | 'hidden' | 'lost' | 'dedup' | 'attachment-ocr' | 'documents' | 'swaps';

export function MatchReviewPage() {
  const [activeTab, setActiveTab] = useState<ClassifyTab>('triage');

  return (
    <div className="flex flex-col h-screen pb-12 bg-background">
      {/* Tab bar */}
      <div className="shrink-0 border-b bg-background flex">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'triage' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('triage')}
        >
          Triage
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'varieties' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('varieties')}
        >
          Variety Matches
        </button>
        {(['unmatched', 'unassigned', 'hidden', 'lost', 'dedup', 'attachment-ocr', 'documents', 'swaps'] as ClassifyTab[]).map(tab => (
          <button
            key={tab}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {{ unmatched: 'No Variety', unassigned: 'No Plant', hidden: 'Hidden', lost: 'Recovered', dedup: 'Dedup Review', 'attachment-ocr': 'Attachment OCR', documents: 'Documents', swaps: 'Res Swaps' }[tab]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'triage' ? <TriageTab /> :
         activeTab === 'varieties' ? <VarietyMatchTab /> :
         activeTab === 'unmatched' ? <UnmatchedTab /> :
         activeTab === 'unassigned' ? <UnassignedTab /> :
         activeTab === 'hidden' ? <HiddenTab /> :
         activeTab === 'lost' ? <LostImageTab /> :
         activeTab === 'dedup' ? <DedupReviewTab /> :
         activeTab === 'documents' ? <DocumentsTab /> :
         activeTab === 'swaps' ? <SwapCandidatesTab /> :
         <AttachmentOcrTab />}
      </div>
      <BottomNav />
    </div>
  );
}


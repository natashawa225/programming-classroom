'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { CheckCircle2, Info, Layers, Database, MessageSquare, Quote, FileText } from 'lucide-react'
import type { CandidateMonitoringGoal, HistoricalEvidenceItem } from '@/lib/services/monitoring-goals-service'

type Props = {
  candidate: CandidateMonitoringGoal | null
  isOpen: boolean
  onClose: () => void
  isAlreadyCreated: boolean
  onCreateGoal: (candidate: CandidateMonitoringGoal) => void
}

export function HistoricalEvidenceDrawer({
  candidate,
  isOpen,
  onClose,
  isAlreadyCreated,
  onCreateGoal,
}: Props) {
  if (!candidate) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader className="space-y-3 border-b border-border/40 pb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-xs">
              Historical Evidence Inspection
            </Badge>

            {isAlreadyCreated ? (
              <Badge className="bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border-emerald-600/20 text-xs">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Teacher-authored monitoring goal
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">
                Candidate monitoring goal derived from historical evidence
              </Badge>
            )}
          </div>

          <DialogTitle className="text-2xl font-bold">{candidate.title}</DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            {candidate.description}
          </DialogDescription>
        </DialogHeader>

        {/* Non-evaluative Pedagogical Guardrail Banner */}
        <div className="my-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 text-xs leading-relaxed space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
            <Info className="h-4 w-4 shrink-0" />
            <span>Observed Pattern & System Guardrail</span>
          </div>
          <p>
            The evidence below highlights student reasoning characteristics extracted from selected clean historical analysis runs.
          </p>
          <p className="font-semibold text-amber-900 dark:text-amber-100 italic pt-1">
            Note: The system does not determine what this means pedagogically. You (the lecturer) decide whether to monitor this pattern in future sessions.
          </p>
        </div>

        {/* Evidence List */}
        <div className="space-y-4 my-2">
          <h4 className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <Database className="h-4 w-4 text-primary" />
            Supporting Historical Classroom Data ({candidate.evidenceItems.length} Sessions/Questions)
          </h4>

          <Accordion type="single" collapsible defaultValue="item-0" className="w-full space-y-3">
            {candidate.evidenceItems.map((item, idx) => (
              <AccordionItem
                key={`${item.sessionId}-${item.questionId}-${idx}`}
                value={`item-${idx}`}
                className="border border-border/60 rounded-xl px-4 py-1 bg-card/50"
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full text-left gap-2 pr-4">
                    <div>
                      <span className="font-semibold text-sm text-foreground">
                        Session {item.sessionCode} (Q{item.questionPosition})
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {item.topicDomain} • {item.sessionDate}
                      </span>
                    </div>
                    <Badge variant="outline" className="text-[11px] font-mono shrink-0 bg-secondary/50">
                      {item.prevalenceCount} of {item.totalResponses} responses ({item.prevalencePercentage}%)
                    </Badge>
                  </div>
                </AccordionTrigger>

                <AccordionContent className="space-y-4 pt-2 pb-4 text-sm text-foreground/90 border-t border-border/40 mt-2">
                  {/* Question Prompt */}
                  <div className="bg-muted/40 p-3 rounded-lg text-xs">
                    <span className="font-semibold text-muted-foreground block mb-1">Question Prompt:</span>
                    <p className="text-foreground leading-relaxed">{item.questionPrompt}</p>
                  </div>

                  {/* Observed Pattern Summary */}
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5 text-primary" /> Cluster Label & Summary:
                    </span>
                    <div className="p-3 rounded-lg border border-primary/20 bg-primary/5">
                      <span className="font-semibold text-primary block text-xs">{item.clusterLabel}</span>
                      <p className="text-xs text-foreground/80 mt-1">{item.clusterDescription}</p>
                      <p className="text-[11px] text-muted-foreground mt-2 border-t border-primary/10 pt-1.5 italic">
                        Observed Note: {item.observedPatternNote}
                      </p>
                    </div>
                  </div>

                  {/* Representative Student Responses */}
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <MessageSquare className="h-3.5 w-3.5 text-primary" /> Representative Student Responses:
                    </span>
                    <div className="space-y-2">
                      {item.sampleResponses.map((sample, sIdx) => (
                        <div key={sIdx} className="bg-background border border-border/60 p-2.5 rounded-lg text-xs space-y-1">
                          <div className="flex items-center justify-between text-muted-foreground text-[11px]">
                            <span>Student Response #{sIdx + 1}</span>
                            {sample.confidence && (
                              <span className="font-medium bg-secondary px-2 py-0.5 rounded">
                                Self-Reported Confidence: {sample.confidence}/5
                              </span>
                            )}
                          </div>
                          <p className="font-medium text-foreground">"{sample.answer}"</p>
                          {sample.explanation && sample.explanation !== sample.answer && (
                            <p className="text-muted-foreground italic">Explanation: {sample.explanation}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Exact Evidence Quotes */}
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <Quote className="h-3.5 w-3.5 text-primary" /> Exact Evidence Quotes:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {item.evidenceQuotes.map((q, qIdx) => (
                        <span key={qIdx} className="text-[11px] bg-secondary/80 text-secondary-foreground px-2 py-1 rounded font-mono">
                          "{q.exact_quote}"
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Traceability Metadata */}
                  <div className="flex items-center justify-between pt-2 border-t border-border/30 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <FileText className="h-3 w-3" /> Selected Analysis Run ID:
                    </span>
                    <span className="font-mono">{item.analysisRunId}</span>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-border/40 mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>

          {!isAlreadyCreated ? (
            <Button
              size="sm"
              onClick={() => {
                onCreateGoal(candidate)
                onClose()
              }}
              className="gap-2"
            >
              <CheckCircle2 className="h-4 w-4" /> Create Monitoring Goal
            </Button>
          ) : (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> Goal active in system
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

% Included ahead of a Mutopia score by mutopia.py (-dinclude-settings): prints
% one line per note LilyPond engraves, with the fingerings written on it.
%
%   NOTE  <score> <staff> <voice> <time> <grace> <midi> <fingers>
%   LOOSE <score> <staff> <voice> <time> <grace> <fingers>
%
% score: 0-based \score block; staff: 1-based, in the order the staves are
% created (top to bottom in a piano score) -- the staff the note is drawn on,
% which \change Staff moves; voice: a number per Voice context, which stays
% the same across staff changes (ids repeat: every \\ split names its voices
% 1 and 2); time: quarters from the start of the piece, as a fraction -- not
% bar and beat, which a \partial can leave LilyPond counting differently from
% the page; grace: 1 for a grace note, whose time is its main note's;
% fingers: comma-separated, "-" for none.
%
% A fingering is a digit (-N) or a \finger "a-b" markup, the way editions
% write a substitution. Inside a chord LilyPond keeps it on its note; after a
% single note it arrives as an event of its own, and goes to that note, as
% LilyPond prints it. Written after a whole chord it belongs to no note: it
% prints as a LOOSE line with the voice and time of the chord's NOTE lines,
% and the caller decides. END <score> closes each \score read to its end.

#(define dump-score -1)
#(define dump-staves '())
#(define dump-voices 0)

#(define (dump-staff-number context)
   (let ((found (member (ly:context-find context 'Staff) dump-staves)))
     (if found (length found) 0)))

#(define (finger-strings markup)
   ;; Every \finger "..." inside a markup, however nested. Only proper lists
   ;; are walked: markups also carry property pairs like (baseline-skip . 1.4).
   ;; A \finger \column { "5" "1" } -- one per note of a chord, top to bottom
   ;; as printed -- comes out as "5|1".
   (cond ((and (pair? markup) (eq? (car markup) finger-markup))
          (let ((arg (cadr markup)))
            (list (if (and (pair? arg) (eq? (car arg) column-markup))
                      (string-join (map markup->string (cadr arg)) "|")
                      (markup->string arg)))))
         ((list? markup) (append-map finger-strings markup))
         (else '())))

#(define (fingers-of event)
   (cond ((memq 'fingering-event (ly:event-property event 'class))
          (let ((digit (ly:event-property event 'digit #f))
                (text (ly:event-property event 'text #f)))
            (cond ((number? digit) (list (number->string digit)))
                  (text (finger-strings text))
                  (else '()))))
         ((memq 'text-script-event (ly:event-property event 'class))
          (finger-strings (ly:event-property event 'text '())))
         (else '())))

#(define (dump-line kind context voice time grace . fields)
   (display (string-join (append (list kind (number->string dump-score)
                                       (number->string (dump-staff-number context))
                                       voice time grace)
                                 fields)
                         "\t"))
   (newline))

#(define (dump-note-engraver context)
   (set! dump-voices (1+ dump-voices))
   (let ((voice (number->string dump-voices))
         (notes '())     ; (event . fingers) started this timestep, newest first
         (loose '()))    ; fingerings that came as events of their own
     (define (take-loose event)
       (set! loose (append loose (fingers-of event))))
     (make-engraver
      (listeners
       ((note-event engraver event)
        (set! notes (cons (cons event (append-map fingers-of (ly:event-property event 'articulations '())))
                          notes)))
       ((fingering-event engraver event) (take-loose event))
       ((text-script-event engraver event) (take-loose event)))
      ((stop-translation-timestep engraver)
       (let* ((now (ly:context-current-moment context))
              (time (number->string (* 4 (ly:moment-main now))))
              (grace (if (zero? (ly:moment-grace now)) "0" "1")))
         (cond ((= 1 (length notes))
                (set-cdr! (car notes) (append (cdar notes) loose)))
               ((pair? loose)
                (dump-line "LOOSE" context voice time grace (string-join loose ","))))
         (for-each
          (lambda (n)
            (dump-line "NOTE" context voice time grace
                       (number->string (+ 60 (ly:pitch-semitones (ly:event-property (car n) 'pitch))))
                       (if (null? (cdr n)) "-" (string-join (cdr n) ","))))
          (reverse notes))
         (set! notes '())
         (set! loose '()))))))

#(define (dump-staff-engraver context)
   (set! dump-staves (cons context dump-staves))
   (make-engraver))

#(define (dump-score-engraver context)
   (set! dump-score (1+ dump-score))
   (set! dump-staves '())
   (make-engraver
    ;; The score was read to its end: without this line, an error cut it short.
    ((finalize engraver)
     (display (string-append "END\t" (number->string dump-score)))
     (newline))))

\layout {
  \context { \Score \consists #dump-score-engraver }
  \context { \Staff \consists #dump-staff-engraver }
  \context { \Voice \consists #dump-note-engraver }
}

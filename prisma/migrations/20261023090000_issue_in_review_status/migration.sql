-- Issues get an "In review" stage between Draft and Accepted, like articles and submissions.
ALTER TYPE "IssueStatus" ADD VALUE 'IN_REVIEW' BEFORE 'ACCEPTED';

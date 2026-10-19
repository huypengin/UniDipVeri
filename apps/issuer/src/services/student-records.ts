/**
 * Course achievement entry within an academic transcript.
 */
export interface CourseRecord {
  code: string;
  title: string;
  credits: number;
  grade: number;
  letterGrade?: string;
}

/**
 * Diploma conferral information.
 */
export interface DiplomaRecord {
  degreeName: string;
  degreeType: string;
  programName: string;
  major: string;
  minor?: string;
  graduationDate: string;
  honours?: string;
}

/**
 * Academic transcript record including GPA, credits, and course listing.
 */
export interface TranscriptRecord {
  transcriptId: string;
  cumulativeGPA?: number;
  totalCredits?: number;
  courses: CourseRecord[];
}

/**
 * Complete student academic record matching schemas/graduation-record.v1.yaml.
 */
export interface StudentAcademicRecord {
  studentId: string;
  fullName: string;
  dateOfBirth?: string;
  nationalId?: string;
  papers: {
    diploma: DiplomaRecord;
    transcript: TranscriptRecord;
  };
  [key: string]: unknown;
}

/**
 * Preloaded demo academic records conforming to schemas/graduation-record.v1.yaml.
 */
export const PRELOADED_STUDENT_RECORDS: Record<string, StudentAcademicRecord> = {
  "STU-2026-FINAL": {
    studentId: "STU-2026-FINAL",
    fullName: "Nguyen Van A",
    dateOfBirth: "2002-05-15",
    nationalId: "001202008899",
    papers: {
      diploma: {
        degreeName: "Bachelor of Science in Computer Science",
        degreeType: "Bachelor of Science",
        programName: "Honors Program in Software Engineering",
        major: "Computer Science",
        minor: "Mathematics",
        graduationDate: "2026-06-30",
        honours: "Summa Cum Laude",
      },
      transcript: {
        transcriptId: "TR-2026-FINAL",
        cumulativeGPA: 3.92,
        totalCredits: 135,
        courses: [
          {
            code: "CS101",
            title: "Introduction to Computer Science",
            credits: 3,
            grade: 4.0,
            letterGrade: "A",
          },
          {
            code: "CS201",
            title: "Data Structures and Algorithms",
            credits: 4,
            grade: 4.0,
            letterGrade: "A",
          },
          {
            code: "CS301",
            title: "Database Systems",
            credits: 3,
            grade: 3.8,
            letterGrade: "A-",
          },
          {
            code: "CS401",
            title: "Distributed Systems & Security",
            credits: 4,
            grade: 4.0,
            letterGrade: "A",
          },
        ],
      },
    },
  },
  "STU-2026-0002": {
    studentId: "STU-2026-0002",
    fullName: "Tran Thi B",
    dateOfBirth: "2003-08-22",
    nationalId: "001203004455",
    papers: {
      diploma: {
        degreeName: "Bachelor of Science in Information Technology",
        degreeType: "Bachelor of Science",
        programName: "General Information Technology",
        major: "Information Technology",
        graduationDate: "2026-06-30",
      },
      transcript: {
        transcriptId: "TR-2026-0002",
        cumulativeGPA: 3.25,
        totalCredits: 128,
        courses: [
          {
            code: "IT101",
            title: "Foundations of IT",
            credits: 3,
            grade: 3.2,
            letterGrade: "B+",
          },
          {
            code: "IT202",
            title: "Web Development",
            credits: 3,
            grade: 3.5,
            letterGrade: "B+",
          },
          {
            code: "IT305",
            title: "Computer Networks",
            credits: 3,
            grade: 3.0,
            letterGrade: "B",
          },
        ],
      },
    },
  },
};

/**
 * Generates a synthetic academic record for arbitrary student IDs.
 * Used as a fallback when issuing credentials for non-preloaded demo IDs.
 */
export function generateStudentRecord(studentId: string): StudentAcademicRecord {
  const sanitizedId = studentId.trim();
  return {
    studentId: sanitizedId,
    fullName: `Student ${sanitizedId}`,
    dateOfBirth: "2003-01-01",
    nationalId: "001000000000",
    papers: {
      diploma: {
        degreeName: "Bachelor of Science in Computer Science",
        degreeType: "Bachelor of Science",
        programName: "Computer Science Program",
        major: "Computer Science",
        graduationDate: "2026-06-30",
      },
      transcript: {
        transcriptId: `TR-${sanitizedId}`,
        cumulativeGPA: 3.5,
        totalCredits: 130,
        courses: [
          {
            code: "CS101",
            title: "Introduction to Computer Science",
            credits: 3,
            grade: 3.7,
            letterGrade: "A-",
          },
          {
            code: "CS201",
            title: "Data Structures",
            credits: 4,
            grade: 3.5,
            letterGrade: "B+",
          },
        ],
      },
    },
  };
}

/**
 * Service managing student academic records for the university registrar.
 */
export class StudentRecordService {
  private readonly records: Map<string, StudentAcademicRecord>;

  constructor(initialRecords: Record<string, StudentAcademicRecord> = PRELOADED_STUDENT_RECORDS) {
    this.records = new Map(Object.entries(initialRecords));
  }

  /**
   * Retrieves an academic record by student identifier.
   * If not explicitly registered, generates a fallback synthetic record.
   */
  getStudentRecord(studentId: string): StudentAcademicRecord {
    const trimmedId = studentId.trim();
    const existing = this.records.get(trimmedId);
    if (existing) {
      return structuredClone(existing);
    }
    return generateStudentRecord(trimmedId);
  }

  /**
   * Checks whether a specific student ID is pre-registered in the repository.
   */
  hasStudentRecord(studentId: string): boolean {
    return this.records.has(studentId.trim());
  }

  /**
   * Registers or updates a student record in the repository.
   */
  registerStudentRecord(record: StudentAcademicRecord): void {
    if (!record.studentId || typeof record.studentId !== "string" || record.studentId.trim().length === 0) {
      throw new Error("Student record must have a valid non-empty studentId");
    }
    this.records.set(record.studentId.trim(), structuredClone(record));
  }

  /**
   * Lists all registered student identifiers.
   */
  listStudentIds(): string[] {
    return Array.from(this.records.keys());
  }
}

using UniDipVeri.Domain.Common;

namespace UniDipVeri.Domain.Entities;

public class AcademicRecord : BaseEntity
{
    public Guid StudentId { get; private set; }
    public int CreditsCompleted { get; private set; }
    public decimal Gpa { get; private set; }
    public List<string> CompletedCourses { get; private set; } = [];
    public DateTime SourceSnapshotAt { get; private set; }
    public DateTime ImportedAt { get; private set; }

    public Student? Student { get; private set; }

    protected AcademicRecord() { }

    public static AcademicRecord Create(
        Guid studentId,
        int creditsCompleted,
        decimal gpa,
        List<string> completedCourses,
        DateTime sourceSnapshotAt,
        Guid? id = null)
    {
        if (studentId == Guid.Empty)
        {
            throw new ArgumentException("StudentId cannot be empty.", nameof(studentId));
        }

        if (creditsCompleted < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(creditsCompleted), "CreditsCompleted cannot be negative.");
        }

        if (gpa < 0.0m || gpa > 4.0m)
        {
            throw new ArgumentOutOfRangeException(nameof(gpa), "GPA must be between 0.0 and 4.0.");
        }

        ArgumentNullException.ThrowIfNull(completedCourses);

        var now = DateTime.UtcNow;
        var record = new AcademicRecord
        {
            StudentId = studentId,
            CreditsCompleted = creditsCompleted,
            Gpa = gpa,
            CompletedCourses = new List<string>(completedCourses),
            SourceSnapshotAt = sourceSnapshotAt,
            ImportedAt = now,
            CreatedAt = now,
            UpdatedAt = now
        };

        if (id.HasValue && id.Value != Guid.Empty)
        {
            record.Id = id.Value;
        }

        return record;
    }

    public void UpdateRecord(
        int creditsCompleted,
        decimal gpa,
        List<string> completedCourses,
        DateTime sourceSnapshotAt)
    {
        if (creditsCompleted < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(creditsCompleted), "CreditsCompleted cannot be negative.");
        }

        if (gpa < 0.0m || gpa > 4.0m)
        {
            throw new ArgumentOutOfRangeException(nameof(gpa), "GPA must be between 0.0 and 4.0.");
        }

        ArgumentNullException.ThrowIfNull(completedCourses);

        var now = DateTime.UtcNow;
        CreditsCompleted = creditsCompleted;
        Gpa = gpa;
        CompletedCourses = new List<string>(completedCourses);
        SourceSnapshotAt = sourceSnapshotAt;
        ImportedAt = now;
        UpdatedAt = now;
    }
}

using UniDipVeri.Domain.Common;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Domain.Entities;

public class Program : BaseEntity
{
    public Guid UniversityId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string FullTitle { get; private set; } = string.Empty;
    public DegreeLevel DegreeLevel { get; private set; } = DegreeLevel.BACHELOR;
    public ProgramStatus Status { get; private set; } = ProgramStatus.ACTIVE;

    public University? University { get; private set; }
    public ICollection<Student> Students { get; private set; } = [];

    protected Program() { }

    public static Program Create(
        Guid universityId,
        string name,
        string fullTitle,
        DegreeLevel degreeLevel,
        ProgramStatus status = ProgramStatus.ACTIVE,
        Guid? id = null)
    {
        if (universityId == Guid.Empty)
        {
            throw new ArgumentException("UniversityId cannot be empty.", nameof(universityId));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(fullTitle);

        var program = new Program
        {
            UniversityId = universityId,
            Name = name.Trim(),
            FullTitle = fullTitle.Trim(),
            DegreeLevel = degreeLevel,
            Status = status,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        if (id.HasValue && id.Value != Guid.Empty)
        {
            program.Id = id.Value;
        }

        return program;
    }

    public bool IsActive() => Status == ProgramStatus.ACTIVE;

    public void UpdateDetails(string name, string fullTitle, DegreeLevel degreeLevel)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(fullTitle);

        // Cross-validation
        string[] validKeywords = degreeLevel.GetDescription().Split(',');

        bool isValidTitle = false;
        foreach (var keyword in validKeywords)
        {
            if (fullTitle.Contains(keyword, StringComparison.OrdinalIgnoreCase))
            {
                isValidTitle = true;
                break;
            }
        }

        if (!isValidTitle)
        {
            throw new ArgumentException(
                $"The degree name '{fullTitle}' is invalid or does not match the degree level '{degreeLevel}'.", nameof(fullTitle));
        }

        Name = name.Trim();
        FullTitle = fullTitle.Trim();
        DegreeLevel = degreeLevel;
        UpdatedAt = DateTime.UtcNow;
    }

    public void Deactivate()
    {
        Status = ProgramStatus.INACTIVE;
        UpdatedAt = DateTime.UtcNow;
    }

    public void Activate()
    {
        Status = ProgramStatus.ACTIVE;
        UpdatedAt = DateTime.UtcNow;
    }
}

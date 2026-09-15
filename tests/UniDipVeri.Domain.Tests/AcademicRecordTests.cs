using FluentAssertions;
using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Domain.Tests;

public class AcademicRecordTests
{
    private readonly Guid _studentId = Guid.NewGuid();
    private readonly DateTime _snapshotAt = DateTime.UtcNow.AddDays(-1);

    [Fact]
    public void Create_ShouldInitializeWithValidArguments()
    {
        var courses = new List<string> { "CS101", "CS102" };
        var record = AcademicRecord.Create(
            _studentId,
            120,
            3.75m,
            courses,
            _snapshotAt);

        record.Id.Should().NotBeEmpty();
        record.StudentId.Should().Be(_studentId);
        record.CreditsCompleted.Should().Be(120);
        record.Gpa.Should().Be(3.75m);
        record.CompletedCourses.Should().Equal("CS101", "CS102");
        record.SourceSnapshotAt.Should().Be(_snapshotAt);
        record.ImportedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(2));
        record.CreatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(2));
        record.UpdatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(2));
    }

    [Fact]
    public void Create_WithExplicitId_ShouldSetId()
    {
        var customId = Guid.NewGuid();
        var record = AcademicRecord.Create(
            _studentId,
            60,
            3.0m,
            [],
            _snapshotAt,
            id: customId);

        record.Id.Should().Be(customId);
        record.CompletedCourses.Should().BeEmpty();
    }

    [Fact]
    public void Create_ShouldThrow_WhenStudentIdIsEmpty()
    {
        var act = () => AcademicRecord.Create(
            Guid.Empty,
            120,
            3.5m,
            ["CS101"],
            _snapshotAt);

        act.Should().Throw<ArgumentException>()
            .WithParameterName("studentId");
    }

    [Fact]
    public void Create_ShouldThrow_WhenCreditsCompletedIsNegative()
    {
        var act = () => AcademicRecord.Create(
            _studentId,
            -1,
            3.5m,
            ["CS101"],
            _snapshotAt);

        act.Should().Throw<ArgumentOutOfRangeException>()
            .WithParameterName("creditsCompleted");
    }

    [Theory]
    [InlineData(-0.01)]
    [InlineData(4.01)]
    [InlineData(5.0)]
    public void Create_ShouldThrow_WhenGpaIsOutOfRange(decimal gpa)
    {
        var act = () => AcademicRecord.Create(
            _studentId,
            120,
            gpa,
            ["CS101"],
            _snapshotAt);

        act.Should().Throw<ArgumentOutOfRangeException>()
            .WithParameterName("gpa");
    }

    [Fact]
    public void Create_ShouldThrow_WhenCompletedCoursesIsNull()
    {
        var act = () => AcademicRecord.Create(
            _studentId,
            120,
            3.5m,
            null!,
            _snapshotAt);

        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("completedCourses");
    }

    [Fact]
    public void UpdateRecord_ShouldUpdateFieldsAndTimestamps()
    {
        var record = AcademicRecord.Create(
            _studentId,
            60,
            3.0m,
            ["CS101"],
            _snapshotAt);

        var newSnapshot = DateTime.UtcNow;
        var updatedCourses = new List<string> { "CS101", "CS102", "CS201" };

        record.UpdateRecord(90, 3.8m, updatedCourses, newSnapshot);

        record.CreditsCompleted.Should().Be(90);
        record.Gpa.Should().Be(3.8m);
        record.CompletedCourses.Should().Equal("CS101", "CS102", "CS201");
        record.SourceSnapshotAt.Should().Be(newSnapshot);
        record.ImportedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(2));
        record.UpdatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(2));
    }

    [Fact]
    public void UpdateRecord_ShouldThrow_WhenInvalidArgs()
    {
        var record = AcademicRecord.Create(
            _studentId,
            60,
            3.0m,
            ["CS101"],
            _snapshotAt);

        var actNegativeCredits = () => record.UpdateRecord(-5, 3.0m, ["CS101"], _snapshotAt);
        actNegativeCredits.Should().Throw<ArgumentOutOfRangeException>()
            .WithParameterName("creditsCompleted");

        var actGpaTooHigh = () => record.UpdateRecord(60, 4.5m, ["CS101"], _snapshotAt);
        actGpaTooHigh.Should().Throw<ArgumentOutOfRangeException>()
            .WithParameterName("gpa");

        var actNullCourses = () => record.UpdateRecord(60, 3.0m, null!, _snapshotAt);
        actNullCourses.Should().Throw<ArgumentNullException>()
            .WithParameterName("completedCourses");
    }

    [Fact]
    public void BaseEntityEquality_ShouldBeBasedOnId()
    {
        var id = Guid.NewGuid();
        var record1 = AcademicRecord.Create(_studentId, 60, 3.0m, [], _snapshotAt, id);
        var record2 = AcademicRecord.Create(_studentId, 120, 4.0m, ["CS101"], _snapshotAt, id);

        record1.Should().Be(record2);
        (record1 == record2).Should().BeTrue();
    }
}

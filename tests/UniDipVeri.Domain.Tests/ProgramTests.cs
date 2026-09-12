using FluentAssertions;
using UniDipVeri.Domain.Enums;
using ProgramEntity = UniDipVeri.Domain.Entities.Program;

namespace UniDipVeri.Domain.Tests;

public class ProgramTests
{
    private readonly Guid _universityId = Guid.NewGuid();

    [Fact]
    public void Create_ShouldInitializeWithDefaults()
    {
        var prog = ProgramEntity.Create(
            _universityId,
            "Computer Science",
            "Bachelor of Science in Computer Science",
            DegreeLevel.BACHELOR);

        prog.Id.Should().NotBeEmpty();
        prog.UniversityId.Should().Be(_universityId);
        prog.Name.Should().Be("Computer Science");
        prog.FullTitle.Should().Be("Bachelor of Science in Computer Science");
        prog.DegreeLevel.Should().Be(DegreeLevel.BACHELOR);
        prog.Status.Should().Be(ProgramStatus.ACTIVE);
        prog.IsActive().Should().BeTrue();
    }

    [Theory]
    [InlineData("", "Bachelor of Computer Science")]
    [InlineData("   ", "Bachelor of Computer Science")]
    [InlineData("Computer Science", "")]
    [InlineData("Computer Science", "   ")]
    public void Create_ShouldThrowArgumentException_WhenNameOrFullTitleIsInvalid(string name, string fullTitle)
    {
        var act = () => ProgramEntity.Create(_universityId, name, fullTitle, DegreeLevel.BACHELOR);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Create_ShouldThrow_WhenUniversityIdIsEmpty()
    {
        var act = () => ProgramEntity.Create(Guid.Empty, "CS", "Bachelor of CS", DegreeLevel.BACHELOR);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Deactivate_ShouldSetStatusToInactive()
    {
        var prog = ProgramEntity.Create(_universityId, "CS", "Bachelor of Computer Science", DegreeLevel.BACHELOR);
        prog.Deactivate();

        prog.Status.Should().Be(ProgramStatus.INACTIVE);
        prog.IsActive().Should().BeFalse();
    }

    [Fact]
    public void Activate_ShouldSetStatusToActive()
    {
        var prog = ProgramEntity.Create(_universityId, "CS", "Bachelor of Computer Science", DegreeLevel.BACHELOR, status: ProgramStatus.INACTIVE);
        prog.Activate();

        prog.Status.Should().Be(ProgramStatus.ACTIVE);
        prog.IsActive().Should().BeTrue();
    }

    [Fact]
    public void UpdateDetails_ShouldUpdateFields()
    {
        var prog = ProgramEntity.Create(_universityId, "Old Name", "Bachelor of Science in Computing", DegreeLevel.BACHELOR);
        prog.UpdateDetails("New Name", "Master of Science in Computer Science", DegreeLevel.MASTER);

        prog.Name.Should().Be("New Name");
        prog.FullTitle.Should().Be("Master of Science in Computer Science");
        prog.DegreeLevel.Should().Be(DegreeLevel.MASTER);
    }

    [Theory]
    [InlineData(DegreeLevel.BACHELOR, "Master of Science")]
    [InlineData(DegreeLevel.MASTER, "Bachelor of Science")]
    [InlineData(DegreeLevel.DOCTORATE, "Master of Philosophy")]
    [InlineData(DegreeLevel.ASSOCIATE, "Bachelor of Applied Science")]
    public void Create_ShouldThrowArgumentException_WhenFullTitleLacksDegreeKeyword(DegreeLevel degreeLevel, string title)
    {
        var act = () => ProgramEntity.Create(_universityId, "Program Name", title, degreeLevel);
        act.Should().Throw<ArgumentException>()
            .WithMessage($"*{title}*");
    }

    [Theory]
    [InlineData(DegreeLevel.BACHELOR, "Bachelor of Science in CS")]
    [InlineData(DegreeLevel.MASTER, "Master of Engineering")]
    [InlineData(DegreeLevel.DOCTORATE, "Doctor of Philosophy in Computer Science")]
    [InlineData(DegreeLevel.DOCTORATE, "PhD in Artificial Intelligence")]
    [InlineData(DegreeLevel.ASSOCIATE, "Associate of Science in IT")]
    public void Create_ShouldSucceed_WhenFullTitleContainsValidDegreeKeyword(DegreeLevel degreeLevel, string title)
    {
        var prog = ProgramEntity.Create(_universityId, "Program Name", title, degreeLevel);
        prog.FullTitle.Should().Be(title);
        prog.DegreeLevel.Should().Be(degreeLevel);
    }

    [Fact]
    public void UpdateDetails_ShouldThrowArgumentException_WhenFullTitleLacksDegreeKeyword()
    {
        var prog = ProgramEntity.Create(_universityId, "CS", "Bachelor of Computer Science", DegreeLevel.BACHELOR);
        var act = () => prog.UpdateDetails("CS", "Master of Computer Science", DegreeLevel.BACHELOR);
        act.Should().Throw<ArgumentException>();
    }
}

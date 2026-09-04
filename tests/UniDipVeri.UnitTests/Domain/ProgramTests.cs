using FluentAssertions;
using UniDipVeri.Domain.Enums;
using ProgramEntity = UniDipVeri.Domain.Entities.Program;

namespace UniDipVeri.UnitTests.Domain;

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
        var prog = ProgramEntity.Create(_universityId, "Old Name", "Old Title", DegreeLevel.BACHELOR);
        prog.UpdateDetails("New Name", "Master of Science in Computer Science", DegreeLevel.MASTER);

        prog.Name.Should().Be("New Name");
        prog.FullTitle.Should().Be("Master of Science in Computer Science");
        prog.DegreeLevel.Should().Be(DegreeLevel.MASTER);
    }
}

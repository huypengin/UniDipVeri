using FluentAssertions;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Domain.Tests;

public class UniversityStaffTests
{
    private readonly Guid _universityId = Guid.NewGuid();

    [Fact]
    public void Create_ShouldInitializeWithDefaults()
    {
        var staff = UniversityStaff.Create(
            _universityId,
            "John Doe",
            "john@miu.edu",
            "hash123",
            StaffRole.REGISTRAR);

        staff.Id.Should().NotBeEmpty();
        staff.UniversityId.Should().Be(_universityId);
        staff.Name.Should().Be("John Doe");
        staff.Email.Should().Be("john@miu.edu");
        staff.Role.Should().Be(StaffRole.REGISTRAR);
        staff.Status.Should().Be(StaffStatus.ACTIVE);
        staff.IsActive().Should().BeTrue();
    }

    [Theory]
    [InlineData("", "email@test.com", "hash")]
    [InlineData("Name", "", "hash")]
    [InlineData("Name", "email@test.com", "")]
    public void Create_ShouldThrowArgumentException_WhenInvalidArgs(
        string name, string email, string hash)
    {
        var act = () => UniversityStaff.Create(_universityId, name, email, hash, StaffRole.REGISTRAR);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Create_ShouldThrow_WhenUniversityIdIsEmpty()
    {
        var act = () => UniversityStaff.Create(Guid.Empty, "Name", "email@test.com", "hash", StaffRole.REGISTRAR);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void HasRole_ShouldReturnTrue_WhenRoleMatches()
    {
        var staff = UniversityStaff.Create(_universityId, "Name", "email@test.com", "hash", StaffRole.ADMIN);
        staff.HasRole(StaffRole.ADMIN).Should().BeTrue();
        staff.HasRole(StaffRole.REGISTRAR).Should().BeFalse();
    }

    [Fact]
    public void Deactivate_ShouldSetStatusToInactive()
    {
        var staff = UniversityStaff.Create(_universityId, "Name", "email@test.com", "hash", StaffRole.ADMIN);
        staff.Deactivate();
        staff.Status.Should().Be(StaffStatus.INACTIVE);
        staff.IsActive().Should().BeFalse();
    }

    [Fact]
    public void Activate_ShouldSetStatusToActive()
    {
        var staff = UniversityStaff.Create(_universityId, "Name", "email@test.com", "hash", StaffRole.ADMIN);
        staff.Deactivate();
        staff.Activate();
        staff.Status.Should().Be(StaffStatus.ACTIVE);
        staff.IsActive().Should().BeTrue();
    }

    [Fact]
    public void UpdateRole_ShouldChangeRole()
    {
        var staff = UniversityStaff.Create(_universityId, "Name", "email@test.com", "hash", StaffRole.REGISTRAR);
        staff.UpdateRole(StaffRole.APPROVER);
        staff.Role.Should().Be(StaffRole.APPROVER);
    }
}
